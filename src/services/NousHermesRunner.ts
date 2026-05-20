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
    const writeHermesDotEnv = (dotEnvPath: string) => {
      const dotEnvEntries: string[] = [];
      const dotEnvKeys = [
        'MINIMAXI_API_KEY',
        'MINIMAX_API_KEY',
        'ANTHROPIC_AUTH_TOKEN',
        'ANTHROPIC_AUTH_TOKEN_1',
        'ANTHROPIC_AUTH_TOKEN_2',
        'ANTHROPIC_AUTH_TOKEN_3',
        'ANTHROPIC_AUTH_TOKEN_4',
        'MINIMAX_CN_API_KEY',
        'OPENROUTER_API_KEY',
        'OPENAI_API_KEY',
        'Z_AI_API_KEY',
        'GLM_API_KEY',
        'Z_AI_API_KEY_2',
        'MISTRAL_API_KEY',
        'NVIDIA_API_KEY',
      ];
      for (const key of dotEnvKeys) {
        if (agentCustomEnv[key]) {
          dotEnvEntries.push(`${key}=${agentCustomEnv[key]}`);
        }
      }
      if (dotEnvEntries.length > 0) {
        const existingContent = fs.existsSync(dotEnvPath)
          ? fs.readFileSync(dotEnvPath, 'utf8')
          : '';
        const newContent = dotEnvEntries.join('\n') + '\n';
        const finalContent = existingContent ? newContent + existingContent : newContent;
        fs.writeFileSync(dotEnvPath, finalContent, 'utf8');
        if (!silent) console.error(`[NousHermesRunner] Wrote ${dotEnvEntries.length} keys to ${dotEnvPath}`);
      }
    };

    let systemPrompt = '';
    if (agentName) {
      try {
        const settingsDir = path.dirname(CONFIG.CLAUDE.PATHS.SETTINGS);
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
        const settings = interpolateEnvVars(rawSettings) as Record<string, any>;

        // Create a temporary settings file with interpolated values (same approach as ClaudeRunner)
        // This ensures $VAR placeholders are resolved before Hermes reads them
        const tmpSettingsPath = path.join(
          path.dirname(agentSettingsPath),
          `settings_${agentName}_tmp.json`,
        );
        fs.writeFileSync(tmpSettingsPath, JSON.stringify(settings, null, 2), 'utf8');
        this.tempFiles.push(tmpSettingsPath);
        const interpolatedSettingsPath = tmpSettingsPath;
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
          // Fusion intelligente : préserver les clés critiques (API keys)
          const criticalKeys = [
            // OpenAI
            'OPENAI_API_KEY',
            'OPENAI_API_BASE',
            'OPENAI_BASE_URL',
            // Mistral
            'MISTRAL_API_KEY',
            'MISTRAL_API_KEY_2',
            'MISTRAL_API_KEY_3',
            'MISTRAL_API_KEY_4',
            'MISTRAL_API_KEY_5',
            'MISTRAL_API_KEY_6',
            'MISTRAL_API_KEY_7',
            // NVIDIA
            'NVIDIA_API_KEY',
            'NVAPI_KEY',
            'NVIDIA_API_BASE',
            // OpenRouter / Overmind
            'OPENROUTER_API_KEY',
            'OVERMIND_EMBEDDING_KEY',
            // MiniMax
            'MINIMAXI_API_KEY',
            // ZhipuAI / GLM
            'Z_AI_API_KEY',
            // Google / Gemini
            'GOOGLE_API_KEY',
            'GEMINI_API_KEY',
            // Anthropic
            'ANTHROPIC_API_KEY',
            'ANTHROPIC_AUTH_TOKEN',
          ];
          const envCopy = { ...settings.env };

          for (const key of criticalKeys) {
            if (agentCustomEnv[key] && !envCopy[key]) {
              envCopy[key] = agentCustomEnv[key];
            }
          }
          Object.assign(agentCustomEnv, envCopy);

          // ─── Resolve $VAR placeholders in agentCustomEnv values ───────────────
          // Hermes reads from process.env, so any "$ANTHROPIC_AUTH_TOKEN_2" style
          // placeholders must be resolved NOW before Hermes is spawned.
          // We iterate all keys and replace known placeholders with resolved values.
          const placeholders: Record<string, string | undefined> = {
            'ANTHROPIC_AUTH_TOKEN_2': process.env.ANTHROPIC_AUTH_TOKEN_2,
            'ANTHROPIC_AUTH_TOKEN_Y': process.env.ANTHROPIC_AUTH_TOKEN_Y,
            'ANTHROPIC_AUTH_TOKEN_E': process.env.ANTHROPIC_AUTH_TOKEN_E,
            'ANTHROPIC_BASE_URL_2': process.env.ANTHROPIC_BASE_URL_2,
            'ANTHROPIC_BASE_URL_Y': process.env.ANTHROPIC_BASE_URL_Y,
            'ANTHROPIC_BASE_URL_E': process.env.ANTHROPIC_BASE_URL_E,
            'MINIMAXI_API_KEY_2': process.env.MINIMAXI_API_KEY_2,
            'OPENAI_API_KEY_2': process.env.OPENAI_API_KEY_2,
            'Z_AI_API_KEY_2': process.env.Z_AI_API_KEY_2,
          };
          for (const [key, value] of Object.entries(agentCustomEnv)) {
            if (typeof value === 'string' && value.startsWith('$')) {
              const resolved = placeholders[value.substring(1)];
              if (resolved) {
                agentCustomEnv[key] = resolved;
                if (!silent) console.error(`[NousHermesRunner] Resolved ${key}=${value.substring(1)} (resolved)`);
              }
            }
          }

          // Map ANTHROPIC_AUTH_TOKEN to provider-specific env vars
          // Hermes z-ai provider needs GLM_API_KEY, not ANTHROPIC_AUTH_TOKEN
          const providerForEnv = options.provider || settings.env?.ANTHROPIC_PROVIDER || '';
          if (providerForEnv.toLowerCase().includes('z-ai') || providerForEnv.toLowerCase().includes('zai')) {
            if (agentCustomEnv.ANTHROPIC_AUTH_TOKEN && !agentCustomEnv['GLM_API_KEY']) {
              agentCustomEnv['GLM_API_KEY'] = agentCustomEnv.ANTHROPIC_AUTH_TOKEN;
              if (!silent) console.error(`[NousHermesRunner] Mapped ANTHROPIC_AUTH_TOKEN → GLM_API_KEY for z-ai provider`);
            }
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
            const mcpConfig = interpolateEnvVars(rawMcpConfig) as Record<string, any>;
            const hermesConfigDir = overmindHermesSubPath;
            if (!fs.existsSync(hermesConfigDir)) fs.mkdirSync(hermesConfigDir, { recursive: true });

            const mcpJsonPath = path.join(hermesConfigDir, 'mcp.json');
            const configYamlPath = path.join(hermesConfigDir, 'config.yaml');

            // Helper pour convertir le format MCP JSON vers le format mcp.json Hermes (identique à Claude Desktop)
            fs.writeFileSync(mcpJsonPath, JSON.stringify(mcpConfig, null, 2), 'utf8');

            // Generer aussi config.yaml (format snake_case attendu par Hermes)
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
                `[NousHermesRunner] 🛠️  Hermes configs (mcp.json & config.yaml) generated in ${hermesConfigDir}`,
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

    // --- CLI Arguments & Prompt Handling ---
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
    const DEFAULT_MODEL = 'tencent/hy3-preview:free'; // Modèle OpenRouter gratuit
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
    const hasMiniMaxKey = !!(
        agentCustomEnv.MINIMAXI_API_KEY ||
        agentCustomEnv.ANTHROPIC_AUTH_TOKEN ||
        agentCustomEnv.ANTHROPIC_AUTH_TOKEN_1 ||
        agentCustomEnv.ANTHROPIC_AUTH_TOKEN_2 ||
        agentCustomEnv.ANTHROPIC_AUTH_TOKEN_3 ||
        agentCustomEnv.ANTHROPIC_AUTH_TOKEN_4
      );

    const isGLMModel = lowModel.includes('glm');
    const hasGLMKey = !!agentCustomEnv.Z_AI_API_KEY;

    const isMistralModel =
      model.includes('mistral') || model.includes('codestral') || model.includes('devstral');
    const hasMistralKey = !!agentCustomEnv.MISTRAL_API_KEY;

    cleanArgs.push('--model', model);

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
        } catch (e) { /* non-critical */ }
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
      logger.info({ model, provider: 'z-ai' }, 'Using ZhipuAI/GLM provider');
      cleanArgs.push('--provider', 'z-ai');
      // Hermes z-ai provider needs GLM_API_KEY specifically
      const resolvedGLMKey = agentCustomEnv.Z_AI_API_KEY;
      if (resolvedGLMKey) {
        agentCustomEnv['GLM_API_KEY'] = resolvedGLMKey;
      }
      // Nettoyage des clés conflictuelles
      delete agentCustomEnv.OPENROUTER_API_KEY;
      delete agentCustomEnv.NVIDIA_API_KEY;
      delete agentCustomEnv.NVAPI_KEY;
      delete agentCustomEnv.OPENAI_API_KEY;
      delete agentCustomEnv.MINIMAXI_API_KEY;
      delete agentCustomEnv.ANTHROPIC_AUTH_TOKEN_4;
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
      this.tempFiles.push(path.join(overmindHermesSubPath, 'mcp.json'), configYamlPath);
    }

    // --hermes-dir: isolate this agent's hermes state (auth.json, .env, sessions)
    // Pass via HERMES_DIR env var (not as CLI flag — --hermes-dir is only for subcommands like "chat")
    const hermesDirEnv = { HERMES_DIR: overmindHermesSubPath };

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

      // shell: false if absolute path (direct binary), true if just "hermes" (needs PATH resolution)
      const useShell = !path.isAbsolute(spawnCommand);
      const child: ChildProcess = spawn(spawnCommand, cleanArgs, {
        cwd: options.cwd || process.cwd(),
        shell: useShell,
        windowsHide: true,
        env: { ...agentCustomEnv, HERMES_DIR: overmindHermesSubPath } as NodeJS.ProcessEnv,
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
