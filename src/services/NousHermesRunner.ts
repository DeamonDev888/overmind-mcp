import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { exec } from 'child_process';
import { promisify } from 'util';
import { CONFIG, resolveConfigPath } from '../lib/config.js';
import { getLastSessionId, saveSessionId } from '../lib/sessions.js';
import { interpolateEnvVars } from '../lib/envUtils.js';
import { withSpan } from '../lib/telemetry.js';
import { loadEnvQuietly } from '../lib/loadEnv.js';
import pino from 'pino';
import {
  registerProcess,
  linkSessionToPid,
  appendOutput,
  updateProcessStatus,
} from '../lib/processRegistry.js';

const execAsync = promisify(exec);

const logger = pino({ name: 'NousHermesRunner' });

// Sur Windows, child.kill() ne tue que le wrapper cmd.exe — le child réel devient
// orphelin. On utilise taskkill /F /T pour propager au sous-arbre complet.
const killProcessTree = (child: ChildProcess): void => {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    exec(`taskkill /F /T /PID ${child.pid}`, () => {
      // taskkill peut échouer si déjà mort — ignoré
    });
  } else {
    try {
      child.kill('SIGTERM');
    } catch {
      // Ignored
    }
    setTimeout(() => {
      if (child.exitCode === null && !child.killed) {
        try {
          child.kill('SIGKILL');
        } catch {
          // Ignored
        }
      }
    }, 5000);
  }
};

export interface RunAgentOptions {
  prompt: string;
  agentName?: string;
  sessionId?: string;
  autoResume?: boolean;
  cwd?: string;
  configPath?: string;
  silent?: boolean;
  model?: string;
  provider?: string;
  hermesArgs?: string[];
  mcpConfigPath?: string;
  signal?: AbortSignal;
}

export interface RunAgentResult {
  result: string;
  sessionId?: string;
  error?: string;
  rawOutput?: string;
  model?: string; // resolved real model ID
  nickname?: string; // original value from config (if different)
  fallbackUsed?: string; // which fallback token was used (e.g. 'AUTH_FALLBACK_1')
}

/**
 * Find hermes binary across platforms (Windows, Linux, macOS)
 * Priority: HERMES_BIN_PATH env > PATH > platform-specific paths > pip show
 */
async function findHermesBinary(): Promise<string> {
  const isWin = process.platform === 'win32';

  // 1. Check environment variable first (allows users to override)
  if (process.env.HERMES_BIN_PATH) {
    if (fs.existsSync(process.env.HERMES_BIN_PATH)) {
      logger.info({ path: process.env.HERMES_BIN_PATH }, 'Using HERMES_BIN_PATH');
      return process.env.HERMES_BIN_PATH;
    }
  }

  // 2. Try to find via PATH
  try {
    const command = isWin ? 'where hermes' : 'which hermes';
    const { stdout } = await execAsync(command);
    const hermesPath = stdout.trim().split('\n')[0];
    if (hermesPath && fs.existsSync(hermesPath)) {
      logger.info({ path: hermesPath }, 'Found hermes in PATH');
      return hermesPath;
    }
  } catch {
    // Not found in PATH
  }

  // 3. Platform-specific paths
  const platformPaths = isWin
    ? [
        // Hermes venv (Nous Research install) — PRIORITÉ haute (v0.13.0, supporte -z)
        path.join(process.env.LOCALAPPDATA || '', 'hermes', 'hermes-agent', 'venv', 'Scripts', 'hermes.exe'),
        // Officiel installer Windows (install.ps1) — chemin natif
        path.join(process.env.LOCALAPPDATA || '', 'hermes', 'bin', 'hermes.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'hermes', 'hermes.exe'),
        // Fallback installations via pip (legacy)
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'Scripts', 'hermes.exe'),
        path.join(process.env.APPDATA || '', 'Python', 'Python312', 'Scripts', 'hermes.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python311', 'Scripts', 'hermes.exe'),
        path.join(process.env.APPDATA || '', 'Python', 'Python311', 'Scripts', 'hermes.exe'),
        'C:\\Python312\\Scripts\\hermes.exe',
        'C:\\Python311\\Scripts\\hermes.exe',
        'C:\\Program Files\\Hermes\\hermes.exe',
      ]
    : [
        path.join(process.env.HOME || '', '.local', 'bin', 'hermes'),
        path.join(process.env.HOME || '', 'miniconda3', 'bin', 'hermes'),
        path.join(process.env.HOME || '', 'anaconda3', 'bin', 'hermes'),
        '/usr/local/bin/hermes',
        '/usr/bin/hermes',
        '/opt/homebrew/bin/hermes',
      ];

  for (const p of platformPaths) {
    if (fs.existsSync(p)) {
      logger.info({ path: p }, 'Found hermes at platform path');
      return p;
    }
  }

  // 4. Try pip show to find installation
  try {
    const { stdout } = await execAsync('pip show hermes-agent 2>/dev/null || pip3 show hermes-agent');
    const match = stdout.match(/Location:\s*(.+)/);
    if (match) {
      const sitePackages = match[1].trim();
      const hermesPath = isWin
        ? path.join(sitePackages, 'Scripts', 'hermes.exe')
        : path.join(sitePackages, 'bin', 'hermes');
      if (fs.existsSync(hermesPath)) {
        logger.info({ path: hermesPath }, 'Found hermes via pip show');
        return hermesPath;
      }
    }
  } catch {
    // pip show failed
  }

  // 5. Fallback to 'hermes' and let spawn fail with proper error
  logger.warn('hermes binary not found, using "hermes" command');
  return 'hermes';
}

/**
 * NousHermesRunner — Runner polyglote pour Hermes Agent.
 * • Providers : OpenAI, MiniMax, Zhipu/GLM, Mistral, NVIDIA NIM, OpenRouter (fallback)
 * • Lit settings/agents/.mcp depuis .claude/ comme les autres runners
 * • Interpolation $VAR et ${VAR} sur tout settings + mcp config (via envUtils)
 * • Isolation : .overmind/hermes/agent_<name>/ (HERMES_HOME)
 */
export class NousHermesRunner {
  private timeoutMs: number;
  private tempFiles: string[] = [];
  private MAX_BUF = 10 * 1024 * 1024; // 10MB buffer limit

  constructor() {
    this.timeoutMs = CONFIG.TIMEOUT_MS || 900000; // 15 min default
  }

  cleanupTempFiles(): void {
    for (const tempFile of this.tempFiles) {
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
          logger.debug({ tempFile }, 'Cleaned up temp file');
        }
      } catch (err) {
        logger.warn({ tempFile, error: err }, 'Failed to cleanup temp file');
      }
    }
    this.tempFiles = [];
  }

  async runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
    try {
      const result = await withSpan(
        'hermes.runAgent',
        async (span) => {
          span.setAttribute('agentName', options.agentName || '');
          span.setAttribute('model', options.model || '');
          span.setAttribute('runner', 'hermes');
          return await this.runAgentInternal(options);
        },
        {
          agentName: options.agentName || '',
          model: options.model || '',
          runner: 'hermes',
        },
      );

      this.cleanupTempFiles();

      if (options.agentName && result.sessionId) {
        await saveSessionId(options.agentName, result.sessionId, options.configPath, 'hermes');
      }

      return result;
    } catch (error) {
      this.cleanupTempFiles();
      logger.error(
        { error: error instanceof Error ? error.message : String(error), agentName: options.agentName },
        'Hermes runner failed',
      );
      throw error;
    }
  }

  async runAgentInternal(options: RunAgentOptions): Promise<RunAgentResult> {
    const { prompt, agentName, autoResume, silent } = options;
    let { sessionId } = options;

    // --- Load .env files first (before anything else) ---
    const cwd = options.cwd || process.cwd();
    loadEnvQuietly(path.join(cwd, '.env'));
    loadEnvQuietly(path.join(cwd, '../Workflow/.env'));

    // --- Auto Resume ---
    if (autoResume && agentName && !sessionId) {
      const lastId = await getLastSessionId(agentName, options.configPath, 'hermes');
      if (lastId) {
        sessionId = lastId;
      }
    }

    const agentCustomEnv: Record<string, string | undefined> = {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
      PYTHONUNBUFFERED: '1',
      PYTHONLEGACYWINDOWSSTDIO: '1',
      TERM: 'emacs',
      PROMPT_TOOLKIT_NO_INTERACTIVE: '1',
      // Force non-interactive for prompt_toolkit
      ANSICON: '1',
      // Map OpenRouter key if needed
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || process.env.OVERMIND_EMBEDDING_KEY,
      // Map NVIDIA NIM key
      NVIDIA_API_KEY: process.env.NVIDIA_API_KEY || process.env.NVAPI_KEY,
      NVIDIA_API_BASE: process.env.NVIDIA_API_BASE || 'https://integrate.api.nvidia.com/v1',
      ...(agentName ? { OVERMIND_AGENT_NAME: agentName } : {}),
    };

    // --- Isolation / Settings / Prompt ---
    const overmindHermesPath = path.resolve(
      cwd,
      '.overmind',
      'hermes',
      agentName ? `agent_${agentName}` : 'central',
    );
    const overmindHermesSubPath = path.join(overmindHermesPath, '.hermes');

    if (!fs.existsSync(overmindHermesSubPath)) {
      fs.mkdirSync(overmindHermesSubPath, { recursive: true });
    }

    // On définit l'environnement pour Hermes
    // IMPORTANT: HERMES_HOME doit pointer vers le dossier contenant config.yaml
    agentCustomEnv.HERMES_HOME = overmindHermesSubPath;

    if (process.platform === 'win32') {
      agentCustomEnv.USERPROFILE = overmindHermesPath;
    } else {
      agentCustomEnv.HOME = overmindHermesPath;
    }

    // ─── Pre-write API keys to HERMES_HOME/.env ───────────────────────────────
    // Hermes (et son credential pool) lisent ~/.hermes/.env très tôt au démarrage,
    // avant même que le credential pool soit initialisé. On écrit les clés
    // critiques dans:
    //   1. HERMES_HOME/.env (notre isolation)
    //   2. ~/.hermes/.env (fallback pour l'init Hermes avant lecture HERMES_HOME)
    //
    // AUTO-DISCOVERY: plutôt que de lister chaque var individuellement (ANTHROPIC_AUTH_TOKEN_Y,
    // MINIMAXI_API_KEY_2, etc.), on collecte automatiquement toutes les vars dont le nom
    // contient un suffixe typiquement associated à des credentials. Tout projet/.env qui
    // suit les conventions de nommage standard (KEY, TOKEN, BASE_URL, ENDPOINT, URL)
    // sera automatiquement exposée à Hermes — sans modification du code.
    const writeHermesDotEnv = (dotEnvPath: string) => {
      const dotEnvEntries: string[] = [];
      for (const [k, v] of Object.entries(agentCustomEnv)) {
        if (
          typeof v === 'string' &&
          v.length > 0 &&
          /^(.*?)(_API_KEY|_AUTH_TOKEN|_BASE_URL|_ENDPOINT|_URL|API_KEY|AUTH_TOKEN|BASE_URL)(.*?)$/i.test(k) &&
          // Exclure les cles problématiques pour eviter qu'elles polluent le .env Hermes
          k !== 'GLM_API_KEY_E' &&
          k !== 'Z_AI_API_KEY'
        ) {
          dotEnvEntries.push(`${k}=${v}`);
        }
      }
      if (dotEnvEntries.length > 0) {
        const existingContent = fs.existsSync(dotEnvPath)
          ? fs.readFileSync(dotEnvPath, 'utf8')
          : '';
        const newContent = dotEnvEntries.join('\n') + '\n';
        // Prepend so our vars take priority over any existing content
        const finalContent = existingContent ? newContent + existingContent : newContent;
        fs.writeFileSync(dotEnvPath, finalContent, 'utf8');
        if (!silent) console.error(`[NousHermesRunner] Wrote ${dotEnvEntries.length} credential vars to ${dotEnvPath}`);
      }
    };

    let systemPrompt = '';
    if (agentName) {
      try {
        const settingsDir = path.dirname(CONFIG.HERMES.PATHS.SETTINGS);
        const agentSettingsPath = resolveConfigPath(
          path.join(settingsDir, `settings_${agentName}.json`),
          options.configPath,
        );

        if (!fs.existsSync(agentSettingsPath)) {
          // Lister les agents disponibles pour aider au debugging
          let availableAgents: string[] = [];
          try {
            const files = fs.readdirSync(settingsDir);
            availableAgents = files
              .filter((f) => f.startsWith('settings_') && f.endsWith('.json'))
              .map((f) => f.replace('settings_', '').replace('.json', ''));
          } catch (e) {
            logger.warn({ settingsDir, error: e }, 'Error reading settings directory');
          }

          return {
            result: '',
            error: `INVALID_AGENT: Agent Hermes "${agentName}" non trouvé.
              Veuillez utiliser 'create_agent' au préalable.
              Fichier attendu: ${agentSettingsPath}
              ${availableAgents.length > 0 ? `Agents disponibles: ${availableAgents.join(', ')}` : 'Aucun agent disponible'}
            `
              .replace(/\s+/g, ' ')
              .trim(),
          };
        }

        const rawSettings = JSON.parse(fs.readFileSync(agentSettingsPath, 'utf8'));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const settings = interpolateEnvVars(rawSettings) as Record<string, any>;

        // Create a temporary settings file with interpolated values (same approach as ClaudeRunner)
        // This ensures $VAR placeholders are resolved before Hermes reads them
        const tmpSettingsPath = path.join(
          path.dirname(agentSettingsPath),
          `settings_${agentName}_tmp.json`,
        );
        fs.writeFileSync(tmpSettingsPath, JSON.stringify(settings, null, 2), 'utf8');
        this.tempFiles.push(tmpSettingsPath);
        // Only use settings.model if it's a string (not a config object like {provider:"custom",...})
        if (!options.model && typeof settings.model === 'string') {
          options.model = settings.model;
        }
        // Extract ANTHROPIC_MODEL from env (used by some agents like sniperbot_analyst)
        if (!options.model && settings.env?.ANTHROPIC_MODEL && !settings.env.ANTHROPIC_MODEL.startsWith('$')) {
          options.model = settings.env.ANTHROPIC_MODEL;
        }
        // Extract ANTHROPIC_PROVIDER from env if present
        if (!options.provider && settings.env?.ANTHROPIC_PROVIDER && !settings.env.ANTHROPIC_PROVIDER.startsWith('$')) {
          options.provider = settings.env.ANTHROPIC_PROVIDER;
        }
        if (settings.env) {
          // ─── Smart merge: inject env vars from process into settings.env ──────────
          // This propagates API keys loaded from .env (loadEnvQuietly above) into the
          // agent's env block. Only inject keys NOT already set in settings.env, so
          // explicit agent settings always take priority.
          // AUTO-DISCOVERY: matches any var with KEY/TOKEN/BASE_URL/ENDPOINT/URL in the name
          // across ALL providers — no per-provider hardcoding needed.
          const _isCredential = (k: string) =>
            /^(.*?)(_API_KEY|_AUTH_TOKEN|_BASE_URL|_ENDPOINT|_URL|API_KEY|AUTH_TOKEN|BASE_URL)(.*?)$/i.test(k);

          const envCopy = { ...settings.env };
          for (const [k, v] of Object.entries(agentCustomEnv)) {
            if (typeof v === 'string' && v.length > 0 && _isCredential(k) && !envCopy[k]) {
              envCopy[k] = v;
            }
          }
          Object.assign(agentCustomEnv, envCopy);

          // ─── Resolve $VAR placeholders before spawning Hermes ──────────────────────
          // Hermes reads process.env — any "$ANTHROPIC_AUTH_TOKEN_Y" style placeholder
          // in settings.env must be resolved here, in-process, before spawn.
          // AUTO-DISCOVERY: the placeholder map starts empty and is populated by
          // scanning process.env for credential vars. Any $VAR in settings.env that
          // matches a var name present in process.env will be resolved — zero config.
          const placeholders: Record<string, string | undefined> = {};
          for (const [k, v] of Object.entries(process.env)) {
            if (typeof v === 'string' && v.length > 0 && _isCredential(k)) {
              placeholders[k] = v;
            }
          }
          for (const [key, value] of Object.entries(agentCustomEnv)) {
            if (typeof value === 'string' && value.startsWith('$')) {
              const resolved = placeholders[value.substring(1)];
              if (resolved) {
                agentCustomEnv[key] = resolved;
                if (!silent) console.error(`[NousHermesRunner] Resolved ${key}=${value.substring(1)} (resolved)`);
              }
            }
          }
          if (!silent) {
            const tokenCount = Object.entries(agentCustomEnv).filter(
              ([k, v]) => typeof v === 'string' && v.length > 0 && _isCredential(k),
            ).length;
            console.error(`[DEBUG-PLACEHOLDER] ${tokenCount} credential vars in agentCustomEnv after resolution`);
          }
        }

          // --- Load System Prompt (agents/agentName.md) ---
        const agentPromptPath = resolveConfigPath(
          path.join(path.dirname(settingsDir), 'agents', `${agentName}.md`),
          options.configPath,
        );

        if (fs.existsSync(agentPromptPath)) {
          systemPrompt = fs.readFileSync(agentPromptPath, 'utf8');
        }

        // --- MCP Config Translation (JSON -> YAML for Hermes) ---
        const agentMcpPath = resolveConfigPath(
          path.join(path.dirname(settingsDir), `.mcp.${agentName}.json`),
          options.configPath,
        );

        if (fs.existsSync(agentMcpPath)) {
          try {
            const rawMcpConfig = JSON.parse(fs.readFileSync(agentMcpPath, 'utf8'));
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const mcpConfig = interpolateEnvVars(rawMcpConfig) as Record<string, any>;
            const hermesConfigDir = overmindHermesSubPath;
            if (!fs.existsSync(hermesConfigDir)) fs.mkdirSync(hermesConfigDir, { recursive: true });

            const configYamlPath = path.join(hermesConfigDir, 'config.yaml');

            // Generate config.yaml (Hermes-native snake_case format)
            // mcp.json is NOT written — Hermes reads config.yaml from HERMES_HOME
            let yamlContent = 'mcp_servers:\n';
            for (const [name, server] of Object.entries(mcpConfig.mcpServers || {})) {
              const s = server as Record<string, unknown>;
              yamlContent += `  ${name}:\n`;
              if (s.command) yamlContent += `    command: "${s.command}"\n`;
              if (s.args && Array.isArray(s.args)) {
                yamlContent += `    args:\n`;
                for (const arg of s.args) {
                  yamlContent += `      - "${String(arg).replace(/"/g, '\\"')}"\n`;
                }
              }
              if (s.env && typeof s.env === 'object') {
                yamlContent += `    env:\n`;
                for (const [k, v] of Object.entries(s.env)) {
                  yamlContent += `      ${k}: "${String(v).replace(/"/g, '\\"')}"\n`;
                }
              }
              if (s.url) yamlContent += `    url: "${s.url}"\n`;
            }
            fs.writeFileSync(configYamlPath, yamlContent, 'utf8');

            // Remove the model config append - it uses 'provider: custom' which Hermes doesn't accept
            // Instead, rely on MINIMAX_BASE_URL_OVERRIDE + MINIMAXI_API_KEY env vars for MiniMaxi
            // The model config in config.yaml is not the right approach

            if (!silent)
              console.error(
                `[NousHermesRunner] 🛠️  Hermes config.yaml generated in ${hermesConfigDir}`,
              );
          } catch (err) {
            logger.error({ error: err }, 'Error translating MCP config');
          }
        }
      } catch (e) {
        if (e instanceof Error && e.message?.includes('INVALID_AGENT')) throw e;
        logger.warn({ agentName, error: e }, 'Error processing agent settings');
      }
    }
    const finalPrompt = systemPrompt ? `${systemPrompt}\n\n[USER QUERY]:\n${prompt}` : prompt;

    // Tronquer si nécessaire pour éviter les limites Windows (8191)
    const MAX_PROMPT_LEN = 7000;
    let cliPrompt = finalPrompt;
    if (cliPrompt.length > MAX_PROMPT_LEN) {
      console.warn(
        `[NousHermesRunner] ⚠️  Prompt tronqué de ${cliPrompt.length} à ${MAX_PROMPT_LEN} chars`,
      );
      cliPrompt = cliPrompt.substring(0, MAX_PROMPT_LEN);
    }

    // Hermes CLI modes:
    // - `hermes -z <prompt>` : top-level one-shot (no banner, clean stdout, auto-exit)
    // - `hermes chat -q <prompt>` : query mode with banner (interactive)
    // - `hermes chat -z <prompt>` : INVALID (subcommand doesn't accept -z)
    // We use top-level `-z` for runner mode (clean output, auto-exit).
    const cleanArgs = ['-z', cliPrompt];

    // --- Model & Provider selection ---
    const DEFAULT_MODEL = CONFIG.HERMES.DEFAULT_MODEL;
    const originalModel = options.model || DEFAULT_MODEL;
    // Guard: ensure model is always a string (not an object from settings.model)
    const modelStr = typeof originalModel === 'string' ? originalModel : DEFAULT_MODEL;
    // Don't use resolveKiloModel here - it adds provider prefix like "minimax/" which
    // causes Hermes to route to OpenRouter instead of MiniMaxi
    const model = modelStr;

    const isNvidiaModel = model.includes('deepseek') || model.includes('nvidia');
    const hasNvidiaKey = !!(agentCustomEnv.NVIDIA_API_KEY || agentCustomEnv.NVAPI_KEY);

    const lowModel = model.toLowerCase();
    const isOpenAIModel =
      lowModel.includes('gpt') ||
      lowModel.includes('o1') ||
      lowModel.includes('o3');
    const hasOpenAIKey = !!agentCustomEnv.OPENAI_API_KEY;

    const isMiniMaxModel = lowModel.includes('minimax') || lowModel.includes('mini-max');
    const hasMiniMaxKey = (() => {
      // Auto-discovery: toute variable contenant 'minimax'/'minimaxi'/'minimax_cn'
      // avec suffixe credential (_API_KEY, _AUTH_TOKEN)
      const _isMiniMaxRelated = (k: string) =>
        /minimax/i.test(k);
      const _hasCredentialSuffix = (k: string) =>
        /_(api_key|auth_token|base_url|endpoint|url)$/i.test(k);
      return Object.entries(agentCustomEnv).some(
        ([k, v]) => typeof v === 'string' && v.length > 0 && _isMiniMaxRelated(k) && _hasCredentialSuffix(k),
      );
    })();

    const isMistralModel =
      model.includes('mistral') || model.includes('codestral') || model.includes('devstral');
    const hasMistralKey = !!agentCustomEnv.MISTRAL_API_KEY;

    // ─── Detect which provider to use based on model name + available credentials ──────────
    // Provider routing is based on model family (glm→z-ai, minimax→minimax-cn, etc.)
    // and whether a corresponding API key is present. Credentials are auto-detected from
    // the full agentCustomEnv — no per-provider key lists needed.
    const isGLMModel = lowModel.includes('glm');
    const hasGLMKey = (() => {
      const glmRelated = ['glm', 'zai', 'z_ai', 'zhipu'];
      return Object.entries(agentCustomEnv).some(
        ([k, v]) =>
          typeof v === 'string' &&
          v.length > 0 &&
          glmRelated.some((t) => k.toLowerCase().includes(t)) &&
          /_(api_key|auth_token|base_url|endpoint|url)$/i.test(k),
      );
    })();

    cleanArgs.push('--model', model);

    // DEBUG: trace GLM detection
    if (!silent) {
      const glmRelated = ['glm', 'zai', 'z_ai', 'zhipu'];
      const glmCreds = Object.entries(agentCustomEnv).filter(
        ([k, v]) =>
          typeof v === 'string' &&
          v.length > 0 &&
          glmRelated.some((t) => k.toLowerCase().includes(t)) &&
          /_(api_key|auth_token|base_url|endpoint|url)$/i.test(k),
      );
      console.error(
        `[DEBUG-GLM-DETECT] model=${model} isGLM=${isGLMModel} hasGLMKey=${hasGLMKey} ` +
        `matched_creds=${glmCreds.map(([k]) => k).join(',') || 'none'}`
      );
    }

    if (isOpenAIModel && hasOpenAIKey) {
      logger.info({ model, provider: 'openai' }, 'Using OpenAI provider');
      cleanArgs.push('--provider', 'openai');
      // Nettoyage des clés conflictuelles
      delete agentCustomEnv.OPENROUTER_API_KEY;
      delete agentCustomEnv.NVIDIA_API_KEY;
      delete agentCustomEnv.NVAPI_KEY;
      delete agentCustomEnv.MINIMAXI_API_KEY;
      delete agentCustomEnv.Z_AI_API_KEY;
    } else if (isMiniMaxModel && hasMiniMaxKey) {
      // Use minimax-cn provider which correctly uses api.minimaxi.com (NOT api.minimax.io)
      // The minimax provider hardcodes api.minimax.io which is wrong for MiniMaxi
      logger.info({ model, provider: 'minimax-cn' }, 'Using MiniMax via minimax-cn provider');
      cleanArgs.push('--provider', 'minimax-cn');
      // Write base_url to config.yaml later (see below, after config generation)
      const resolvedMiniMaxKey = agentCustomEnv.ANTHROPIC_AUTH_TOKEN_4 ||
        agentCustomEnv.ANTHROPIC_AUTH_TOKEN_3 ||
        agentCustomEnv.ANTHROPIC_AUTH_TOKEN_2 ||
        agentCustomEnv.ANTHROPIC_AUTH_TOKEN ||
        agentCustomEnv.MINIMAXI_API_KEY ||
        process.env.MINIMAXI_API_KEY;
      if (resolvedMiniMaxKey) {
        agentCustomEnv.ANTHROPIC_TOKEN = resolvedMiniMaxKey;
        agentCustomEnv.ANTHROPIC_AUTH_TOKEN = resolvedMiniMaxKey;
        agentCustomEnv.ANTHROPIC_AUTH_TOKEN_4 = resolvedMiniMaxKey;
        agentCustomEnv.MINIMAXI_API_KEY = resolvedMiniMaxKey;
        agentCustomEnv.MINIMAX_API_KEY = resolvedMiniMaxKey;
        // minimax-cn provider reads MINIMAX_CN_API_KEY specifically
        agentCustomEnv.MINIMAX_CN_API_KEY = resolvedMiniMaxKey;
        // Force rewrite the auth.json so Hermes picks up the new key
        try {
          const authPath = path.join(process.env.HOME || process.env.USERPROFILE || '', '.hermes', 'auth.json');
          if (fs.existsSync(authPath)) {
            const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
            if (auth.credential_pool?.['minimax-cn']?.[0]) {
              auth.credential_pool['minimax-cn'][0].access_token = resolvedMiniMaxKey;
              auth.credential_pool['minimax-cn'][0].last_status = null;
              auth.credential_pool['minimax-cn'][0].last_error_code = null;
              fs.writeFileSync(authPath, JSON.stringify(auth, null, 2), 'utf8');
              if (!silent) console.error(`[NousHermesRunner] Updated minimax-cn credential in auth.json`);
            }
          }
        } catch (_e) { /* non-critical */ }
        if (!silent) console.error(`[NousHermesRunner] Set ANTHROPIC_AUTH_TOKEN_4 for MiniMax via minimax-cn`);
      }
      delete agentCustomEnv.OPENROUTER_API_KEY;
      delete agentCustomEnv.OVERMIND_EMBEDDING_KEY;
      delete agentCustomEnv.NVIDIA_API_KEY;
      delete agentCustomEnv.NVIDIA_API_BASE;
      delete agentCustomEnv.NVAPI_KEY;
      delete agentCustomEnv.OPENAI_API_KEY;
      delete agentCustomEnv.Z_AI_API_KEY;
    } else if (isGLMModel && hasGLMKey) {
      // ════════════════════════════════════════════════════════════════════════════
      // Z.AI / GLM via provider 'z-ai'
      //
      // ENDPOINT: https://api.z.ai/api/coding/paas/v4 (CODING PLAN uniquement)
      //   → /paas/v4 standards = 429 Insufficient balance (CRÉDITS GLM INSUFFISANTS)
      //   → /coding/paas/v4 = 200 OK ( glm-5.1, glm-5v-turbo, glm-4.7 )
      //
      // TOKEN: n'importe quelle variable contenant 'glm'/'z_ai'/'zai'/'zhipu'
      //   avec suffixe _API_KEY ou _AUTH_TOKEN (auto-détectée, pas de nom codé)
      //
      // PRIORITÉ CLÉ API GLM:
      //   1. Z_AI_API_KEY (fallback legacy)
      //   2. auto-detect: premiere variable glm/zai + suffixe credential
      //
      // PRIORITÉ BASE URL:
      //   1. ZAI_BASE_URL_3  → https://api.z.ai/api/coding/paas/v4  (CODING GLOBAL)
      //   2. ZAI_BASE_URL_4  → https://open.bigmodel.cn/api/coding/paas/v4 (CODING CN)
      //   3. auto-detect glm/zai URL (decouverte par suffixe _base_url/_url/_endpoint)
      //   4. DEFAULT: https://api.z.ai/api/coding/paas/v4
      //
      // PROVIDER: z-ai (OpenAI-compatible /paas/v4)
      // MODÈLES: glm-5.1, glm-5v-turbo, glm-4.7, glm-4-plus, etc.
      // ════════════════════════════════════════════════════════════════════════════
      const _glmTokenSuffix = /_(api_key|auth_token)$/i;
      const _glmUrlSuffix = /_(base_url|endpoint|url)$/i;
      const _isGlmRelated = (k: string) =>
        /glm|z_?ai|zhipu/i.test(k);

      // Cle API: priorite Z_AI_API_KEY > GLM_API_KEY_Y > GLM_API_KEY_E > premiere glm/zai
      // Z_AI_API_KEY et GLM_API_KEY_Y sont les cles Z.AI veritables
      // GLM_API_KEY_E est une cle ANTHROPIC (ne marche pas avec le provider z-ai)
      // On filtre aussi les cles ANTHROPIC qui contiennent "glm" (ex: GLM_API_KEY_E)
      // Z_AI_API_KEY=sk-fd9...6a93 est une cle INVALID pour Z.AI (format diff)
      const _isExcludedGlm = (k: string) =>
        /^ANTHROPIC/i.test(k) ||
        /^(GLM_API_KEY_E|Z_AI_API_KEY)$/i.test(k); // pas des cles Z.AI reelles
      const glmKeyEntry = Object.entries(agentCustomEnv).find(
        ([k, v]) =>
          typeof v === 'string' &&
          v.length > 0 &&
          _isGlmRelated(k) &&
          _glmTokenSuffix.test(k) &&
          !_isExcludedGlm(k),
      );
      if (glmKeyEntry) {
        agentCustomEnv['GLM_API_KEY'] = glmKeyEntry[1];
        if (!silent) console.error(`[DEBUG-GLM] GLM_API_KEY <= ${glmKeyEntry[0]}`);
        // Supprimer les clés glm/zai problématiques de l'env pour eviter qu'Hermes les trouve
        delete agentCustomEnv['GLM_API_KEY_E'];
        delete agentCustomEnv['Z_AI_API_KEY'];
      }

      // IMPORTANT: write GLM_API_KEY to agentCustomEnv explicitly.
      // Le writeHermesDotEnv filter regex exclut GLM_API_KEY_Y (suffixe _Y != _API_KEY)
      // donc on doit l'ecrire nous-meme pour que Hermes le trouve dans l'env.
      if (agentCustomEnv['GLM_API_KEY_Y']) {
        agentCustomEnv['GLM_API_KEY'] = agentCustomEnv['GLM_API_KEY_Y'];
      }

      // URL: ZAI_BASE_URL_3 (coding plan) en priorite, puis auto-detect, puis default
      const ZAI_CODING_ENDPOINT = 'https://api.z.ai/api/coding/paas/v4';
      const zaiUrl3 = agentCustomEnv['ZAI_BASE_URL_3'];
      const zaiUrl4 = agentCustomEnv['ZAI_BASE_URL_4'];
      const glmUrlEntry = Object.entries(agentCustomEnv).find(
        ([k, v]) =>
          typeof v === 'string' &&
          v.length > 0 &&
          _isGlmRelated(k) &&
          _glmUrlSuffix.test(k) &&
          k !== 'ZAI_BASE_URL_3' &&
          k !== 'ZAI_BASE_URL_4',
      );
      if (zaiUrl3) {
        agentCustomEnv['GLM_BASE_URL'] = zaiUrl3;
        if (!silent) console.error(`[DEBUG-GLM] GLM_BASE_URL <= ZAI_BASE_URL_3 (coding plan)`);
      } else if (zaiUrl4) {
        agentCustomEnv['GLM_BASE_URL'] = zaiUrl4;
        if (!silent) console.error(`[DEBUG-GLM] GLM_BASE_URL <= ZAI_BASE_URL_4 (coding plan China)`);
      } else if (glmUrlEntry) {
        agentCustomEnv['GLM_BASE_URL'] = glmUrlEntry[1];
        if (!silent) console.error(`[DEBUG-GLM] GLM_BASE_URL <= ${glmUrlEntry[0]}`);
      } else {
        agentCustomEnv['GLM_BASE_URL'] = ZAI_CODING_ENDPOINT;
        if (!silent) console.error(`[DEBUG-GLM] GLM_BASE_URL <= ${ZAI_CODING_ENDPOINT} (default coding plan)`);
      }

      logger.info({ model, provider: 'z-ai' }, 'Using ZhipuAI/GLM provider');
      cleanArgs.push('--provider', 'z-ai');
      // Cleanup conflicting keys
      delete agentCustomEnv.OPENROUTER_API_KEY;
      delete agentCustomEnv.NVIDIA_API_KEY;
      delete agentCustomEnv.NVAPI_KEY;
      delete agentCustomEnv.OPENAI_API_KEY;
      delete agentCustomEnv.MINIMAXI_API_KEY;
      // IMPORTANT: delete ANTHROPIC_BASE_URL_Z — c'est l'endpoint Claude Z.AI (anthropic/v1),
      // pas le coding plan Z.AI (coding/paas/v4). Hermes lit .env et utilise cette var
      // comme override, ce qui fait échouer les appels GLM avec 404.
      delete agentCustomEnv.ANTHROPIC_BASE_URL_Z;
      delete agentCustomEnv.ANTHROPIC_BASE_URL_E;
      delete agentCustomEnv.ANTHROPIC_BASE_URL_3;
      delete agentCustomEnv.ANTHROPIC_BASE_URL_4;
      delete agentCustomEnv.BASE_URL_Z;
      // Update auth.json credential pool for z-ai (same pattern as minimax-cn)
      // Hermes reads auth.json from HERMES_HOME (overmindHermesSubPath), NOT from the global
      // %LOCALAPPDATA%\hermes\auth.json. So we must write it to overmindHermesSubPath.
      const glmApiKey = agentCustomEnv['GLM_API_KEY'];
      if (glmApiKey && overmindHermesSubPath) {
        try {
          const hermesAuthPath = path.join(overmindHermesSubPath, 'auth.json');
          let auth: Record<string, unknown> = { version: 1, providers: {}, credential_pool: {} };
          if (fs.existsSync(hermesAuthPath)) {
            auth = JSON.parse(fs.readFileSync(hermesAuthPath, 'utf8'));
            if (!auth.credential_pool) auth.credential_pool = {};
          }
          if (!auth.credential_pool) auth.credential_pool = {};
          if (!Array.isArray((auth.credential_pool as Record<string, unknown>)['zai'])) {
            (auth.credential_pool as Record<string, unknown>)['zai'] = [];
          }
          const zaiPool = ((auth.credential_pool as Record<string, unknown>)['zai'] as Record<string, unknown>[]);
          // Update existing or add new
          const existing = zaiPool.find((c) => c.label === 'GLM_API_KEY');
          if (existing) {
            existing.access_token = glmApiKey;
            existing.base_url = agentCustomEnv['GLM_BASE_URL'] || ZAI_CODING_ENDPOINT;
            existing.last_status = null;
            existing.last_error_code = null;
          } else {
            zaiPool.push({
              id: 'zai-default',
              label: 'GLM_API_KEY',
              auth_type: 'api_key',
              priority: 0,
              source: 'env:GLM_API_KEY',
              access_token: glmApiKey,
              last_status: null,
              last_status_at: null,
              last_error_code: null,
              last_error_reason: null,
              last_error_message: null,
              last_error_reset_at: null,
              base_url: agentCustomEnv['GLM_BASE_URL'] || ZAI_CODING_ENDPOINT,
              request_count: 0,
            });
          }
          fs.writeFileSync(hermesAuthPath, JSON.stringify(auth, null, 2), 'utf8');
          if (!silent) console.error(`[NousHermesRunner] Updated zai credential in ${hermesAuthPath}`);
        } catch (_e) { /* non-critical */ }
      }
    } else if (isMistralModel && hasMistralKey) {
      logger.info({ model, provider: 'mistral' }, 'Using Mistral provider');
      cleanArgs.push('--provider', 'mistral');
      // Nettoyage des clés conflictuelles
      delete agentCustomEnv.OPENROUTER_API_KEY;
      delete agentCustomEnv.NVIDIA_API_KEY;
      delete agentCustomEnv.NVAPI_KEY;
      delete agentCustomEnv.OPENAI_API_KEY;
    } else if (isNvidiaModel && hasNvidiaKey) {
      logger.info({ model, provider: 'nvidia' }, 'Using NVIDIA NIM provider');
      cleanArgs.push('--provider', 'nvidia');
    } else {
      // Fallback OpenRouter pour tout le reste ou si clé NIM manquante
      logger.info({ model, provider: 'openrouter' }, 'Using OpenRouter provider');
      cleanArgs.push('--provider', 'openrouter');
    }

    // Re-write .env with all provider-specific keys now resolved (e.g. GLM_API_KEY for z-ai)
    const defaultHermesHome = path.join(process.env.HOME || process.env.USERPROFILE || '', '.hermes');
    writeHermesDotEnv(path.join(overmindHermesSubPath, '.env'));
    writeHermesDotEnv(path.join(defaultHermesHome, '.env'));

    // --- Hermes-native flags: --resume, --mcp-config ---
    // NOTE: --name is NOT supported by Hermes CLI v0.11.0+ (unrecognized argument error).
    // Session naming works via --resume or --continue, not --name.

    // --resume: continue existing session
    if (sessionId) {
      cleanArgs.push('--resume', sessionId);
    }

    // --mcp-config: point Hermes to our generated config.yaml
    // Generated at lines 419-448 in overmindHermesSubPath
    const configYamlPath = path.join(overmindHermesSubPath, 'config.yaml');
    if (fs.existsSync(configYamlPath)) {
      cleanArgs.push('--mcp-config', configYamlPath);
      this.tempFiles.push(configYamlPath);
    }

    // --hermes-dir: isolate this agent's hermes state (auth.json, .env, sessions)
    // HERMES_DIR is passed inline in the spawn env below (not as CLI flag — --hermes-dir is only for subcommands like "chat")

    // --- Find Hermes Binary (cross-platform) ---
    const spawnCommand = await findHermesBinary();

    if (!silent) {
      logger.info({ command: spawnCommand, args: cleanArgs }, 'Starting Hermes Agent');
    }

    return new Promise((resolve) => {
      let resolved = false;
      const safeResolve = (value: RunAgentResult) => {
        if (!resolved) {
          resolved = true;
          resolve(value);
        }
      };

      // shell: false if absolute path (direct binary), true if just "hermes" (needs PATH resolution).
      // On Windows, hermes.exe is a Python venv wrapper. VIRTUAL_ENV + venv root in PATH
      // ensures the correct Python is used, so shell=true is not needed.
      const useShell = !path.isAbsolute(spawnCommand);
      const child: ChildProcess = spawn(spawnCommand, cleanArgs, {
        cwd: options.cwd || process.cwd(),
        shell: useShell,
        windowsHide: true,
        env: {
          ...agentCustomEnv,
          HERMES_HOME: overmindHermesSubPath,
          // On Windows, hermes.exe is a Python venv wrapper. The wrapper uses
          // `sys.executable` as the Python interpreter. Without VIRTUAL_ENV, the wrapper
          // finds the wrong Python (system Python311) and crashes with
          // "NameError: name 'base_events' is not defined".
          // Solution: set VIRTUAL_ENV + prepend venv ROOT to PATH (not Scripts\).
          // Use FORWARD SLASHES (/ instead of \) — Node.js spawn on Windows needs this
          // when paths appear in env vars with backslash-containing values.
          VIRTUAL_ENV: 'C:/Users/Deamon/AppData/Local/hermes/hermes-agent/venv',
          PATH: `C:/Users/Deamon/AppData/Local/hermes/hermes-agent/venv;${process.env.PATH || ''}`,
        } as NodeJS.ProcessEnv,
      });

      if (child.pid) {
        void registerProcess(child.pid, { agentName: agentName || '', runner: 'hermes', configPath: options.configPath });
        if (sessionId) void linkSessionToPid(sessionId, child.pid, options.configPath);
      }

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (d: Buffer) => {
        const chunk = d.toString();
        if (child.pid) void appendOutput(child.pid, chunk, options.configPath);
        if (stdout.length + chunk.length > this.MAX_BUF) {
          stdout = stdout.slice(-this.MAX_BUF);
        }
        stdout += chunk;
        if (!silent) {
          process.stderr.write(`[Hermes] ${chunk}`);
        }
      });

      child.stderr?.on('data', (d: Buffer) => {
        const chunk = d.toString();
        if (stderr.length + chunk.length > this.MAX_BUF) {
          stderr = stderr.slice(-this.MAX_BUF);
        }
        stderr += chunk;
        if (!silent) {
          process.stderr.write(`[Hermes:ERR] ${chunk}`);
        }
      });

      const timeout = setTimeout(() => {
        killProcessTree(child);
        if (child.pid) void updateProcessStatus(child.pid, 'failed', null, options.configPath);
        safeResolve({
          result: stdout.trim(),
          error: 'TIMEOUT',
          rawOutput: stdout + '\n\n' + stderr,
          model,
          nickname: originalModel !== model ? originalModel : undefined,
          fallbackUsed: undefined,
        });
      }, this.timeoutMs);

      // AbortSignal support (like ClaudeRunner)
      if (options.signal) {
        const onAbort = () => {
          clearTimeout(timeout);
          killProcessTree(child);
          if (child.pid) void updateProcessStatus(child.pid, 'failed', null, options.configPath);
          safeResolve({
            result: stdout.trim(),
            error: 'ABORTED',
            rawOutput: stdout + '\n\n' + stderr,
            model,
            nickname: originalModel !== model ? originalModel : undefined,
            fallbackUsed: undefined,
          });
        };
        if (options.signal.aborted) {
          onAbort();
        } else {
          options.signal.addEventListener('abort', onAbort, { once: true });
        }
      }

child.on('close', async (code: number | null) => {
        clearTimeout(timeout);
        if (child.pid) void updateProcessStatus(child.pid, code === 0 ? 'done' : 'failed', code, options.configPath);

        // Parse session ID from Hermes output (e.g. "Session: 20260515_204158_7093cd")
        // This works even when Hermes exits with error, as the banner is still printed
        let parsedSessionId = sessionId;
        const sessionMatch = stdout.match(/Session:\s+(\S+)/);
        if (sessionMatch) {
          parsedSessionId = sessionMatch[1];
        }

        // Hermes exits code 2 on API errors (e.g. max_tokens > 40000).
        // When stdout has content, return it even on non-zero exit — it's useful output.
        if (code !== 0 && !stdout) {
          return safeResolve({
            result: '',
            error: `EXIT_CODE_${code}`,
            rawOutput: stderr || stdout,
            sessionId: parsedSessionId,
            model,
            nickname: originalModel !== model ? originalModel : undefined,
            fallbackUsed: undefined,
          });
        }

        safeResolve({
          result: stdout.trim(),
          sessionId: parsedSessionId,
          rawOutput: stdout,
          model,
          nickname: originalModel !== model ? originalModel : undefined,
        });
      });

      child.on('error', (err: Error) => {
        clearTimeout(timeout);
        if (child.pid) void updateProcessStatus(child.pid, 'failed', null, options.configPath);
        safeResolve({ result: '', error: `SPAWN_ERROR: ${err.message}`, rawOutput: '' });
      });

      // Do NOT call child.stdin.end() — it sends EOF and Hermes closes.
      // Keep stdin open so Hermes stays alive for resume.
    });
  }
}
