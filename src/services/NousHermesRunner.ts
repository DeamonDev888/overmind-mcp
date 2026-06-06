import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { exec } from 'child_process';
import { promisify } from 'util';
import { CONFIG, resolveConfigPath, getWorkspaceDir } from '../lib/config.js';
import { getLastSessionId, saveSessionId } from '../lib/sessions.js';
import { linkSessionToPid } from '../lib/processRegistry.js';
import { interpolateEnvVars } from '../lib/envUtils.js';
import { withSpan } from '../lib/telemetry.js';
import { loadEnvQuietly } from '../lib/loadEnv.js';
import pino from 'pino';
import {
  registerProcess,
  appendOutput,
  updateProcessStatus,
} from '../lib/processRegistry.js';
import {
  registerLiveAgent,
  appendLiveOutput,
  setLiveStatus,
  unregisterLiveAgent,
} from '../lib/agent_lifecycle.js';

const execAsync = promisify(exec);

const logger = pino({ name: 'NousHermesRunner' });

// Sur Windows, child.kill() ne tue que le wrapper cmd.exe — le child réel devient
// orphelin. On utilise taskkill /F /T pour propager le kill au sous-arbre complet.
const killProcessTree = (child: ChildProcess): Promise<void> => {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.killed) {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    child.once('exit', finish);
    if (process.platform === 'win32' && child.pid) {
      exec(`taskkill /F /T /PID ${child.pid}`, () => {
        // taskkill peut échouer si le process est déjà mort
      });
    } else {
      try { child.kill('SIGTERM'); } catch { /* ignored */ }
      setTimeout(() => {
        if (child.exitCode === null && !child.killed) {
          try { child.kill('SIGKILL'); } catch { /* ignored */ }
        }
      }, 2000);
    }
    setTimeout(finish, 5000);
  });
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
    const cwd = options.cwd || process.cwd();
    const configPath = options.configPath || getWorkspaceDir();

    // Load .env files FIRST
    loadEnvQuietly(path.join(cwd, '.env'));
    loadEnvQuietly(path.join(cwd, '../Workflow/.env'));

    // Auto Resume
    if (autoResume && agentName && !sessionId) {
      const lastId = await getLastSessionId(agentName, configPath, 'hermes');
      if (lastId) {
        sessionId = lastId;
        if (!silent) console.error(`[NousHermesRunner] Auto-resume session: ${sessionId}`);
      }
    }

    const MAX_BUF = 10 * 1024 * 1024;
    const timeoutMs = this.timeoutMs;
    const HARD_TIMEOUT_MS = 60000;

    // HERMES_HOME setup
    const overmindHermesPath = path.resolve(cwd, '.overmind', 'hermes', agentName ? `agent_${agentName}` : 'central');
    const overmindHermesSubPath = path.join(overmindHermesPath, '.hermes');

    if (agentName && !fs.existsSync(overmindHermesPath)) {
      return { result: '', error: `INVALID_AGENT: Agent Hermes "${agentName}" non trouvé.` };
    }

    // Load agent settings + MCP config (same pattern as ClaudeRunner)
    let systemPrompt = '';
    let resolvedModel: string | undefined;
    let resolvedProvider: string | undefined;
    const agentCustomEnv: Record<string, string | undefined> = {
      ...process.env,
      PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', PYTHONUNBUFFERED: '1',
      PYTHONLEGACYWINDOWSSTDIO: '1', TERM: 'emacs',
      PROMPT_TOOLKIT_NO_INTERACTIVE: '1', ANSICON: '1',
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '',
      NVIDIA_API_KEY: process.env.NVIDIA_API_KEY || process.env.NVAPI_KEY,
      NVIDIA_API_BASE: process.env.NVIDIA_API_BASE || 'https://integrate.api.nvidia.com/v1',
      ...(agentName ? { OVERMIND_AGENT_NAME: agentName } : {}),
      // OVERMIND_AGENT_HOME tells Hermes (v0.13.0+) to read agent-specific .env FIRST
      // get_env_value() in Hermes checks OVERMIND_AGENT_HOME/.hermes/.env before HERMES_HOME/.env
      // This allows $VAR expansion done by Overmind to take precedence over gateway .env
      ...(agentName ? { OVERMIND_AGENT_HOME: path.resolve(cwd, '.overmind', 'hermes', `agent_${agentName}`) } : {}),
      // NOTE: do NOT pre-seed GLM_API_KEY with '' here. The real value comes from
      // settings_<agent>.json (merged below) or from the agent's .hermes/.env file.
      // Seeding '' here used to win against Object.assign() whenever interpolateEnvVars()
      // returned an empty value for $GLM_API_KEY (e.g. shell parent didn't export it),
      // which silently nulled out getTokenForIndex() and caused EXIT_CODE_1 / 401 errors.
    };

    let tmpSettingsPath: string | null = null;
    let tmpMcpPath: string | null = null;
    // Capture the RAW (pre-interpolation) settings tokens so getTokenForIndex can
    // fail-loud on unresolved $VAR references and report which one is missing.
    // (Once interpolateEnvVars() runs, $VAR has been replaced with its value, and
    //  we lose the information that the user explicitly asked for THAT var.)
    const rawExplicitSettingsTokens: Array<{ key: string; value: string }> = [];

    // ============================================================
    // TOKEN_KEYS — declared at top of scope so it's available for the RAW
    // pre-interpolation capture in the settings-load block above. This is
    // 100% exhaustive — every env-var name the runner knows about.
    // ============================================================
    const TOKEN_KEYS = [
      // Generic Anthropic-compatible (Hermes v0.16.0)
      'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_AUTH_TOKEN_E', 'ANTHROPIC_AUTH_TOKEN_F', 'ANTHROPIC_AUTH_TOKEN_Y',
      // Suffixes numériques 1..9 (convention observée dans les .env prod)
      'ANTHROPIC_AUTH_TOKEN_1', 'ANTHROPIC_AUTH_TOKEN_2', 'ANTHROPIC_AUTH_TOKEN_3', 'ANTHROPIC_AUTH_TOKEN_4', 'ANTHROPIC_AUTH_TOKEN_5',
      'ANTHROPIC_AUTH_TOKEN_6', 'ANTHROPIC_AUTH_TOKEN_7', 'ANTHROPIC_AUTH_TOKEN_8', 'ANTHROPIC_AUTH_TOKEN_9',
      'ANTHROPIC_AUTH_TOKEN_0',
      // Z.AI / GLM
      'GLM_API_KEY', 'GLM_API_KEY_E', 'GLM_API_KEY_Y',
      'Z_AI_API_KEY', 'ZAI_ANTHROPIC_FALLBACK_KEY',
      'ZAI_API_KEY_E', 'ZAI_API_KEY_Y',
      'ZAI_API_KEY_1', 'ZAI_API_KEY_2', 'ZAI_API_KEY_3', 'ZAI_API_KEY_4', 'ZAI_API_KEY_5',
      'ZAI_API_KEY_6', 'ZAI_API_KEY_7', 'ZAI_API_KEY_8', 'ZAI_API_KEY_9', 'ZAI_API_KEY_0',
      // MiniMax
      'MINIMAX_API_KEY', 'MINIMAX_CN_API_KEY',
      'MINIMAX_API_KEY_E', 'MINIMAX_API_KEY_Y',
      'MINIMAX_API_KEY_1', 'MINIMAX_API_KEY_2', 'MINIMAX_API_KEY_3', 'MINIMAX_API_KEY_4', 'MINIMAX_API_KEY_5',
      'MINIMAX_CN_API_KEY_E', 'MINIMAX_CN_API_KEY_Y',
      'MINIMAX_CN_API_KEY_1', 'MINIMAX_CN_API_KEY_2', 'MINIMAX_CN_API_KEY_3', 'MINIMAX_CN_API_KEY_4', 'MINIMAX_CN_API_KEY_5',
      // OpenAI fallback
      'OPENAI_API_KEY', 'OPENAI_AUTH_TOKEN',
      // Mistral
      'MISTRAL_API_KEY', 'MISTRAL_API_KEY_1', 'MISTRAL_API_KEY_2', 'MISTRAL_API_KEY_3', 'MISTRAL_API_KEY_4', 'MISTRAL_API_KEY_5',
      'MISTRAL_API_KEY_6', 'MISTRAL_API_KEY_7', 'MISTRAL_API_KEY_E', 'MISTRAL_API_KEY_Y',
    ];

    if (agentName) {
      const agentPromptPath = path.join(overmindHermesSubPath, 'SOUL.md');
      if (fs.existsSync(agentPromptPath)) {
        systemPrompt = fs.readFileSync(agentPromptPath, 'utf8');
      }

      // Load environment variables from .claude/settings_<agentName>.json
      try {
        const agentSettingsPath = resolveConfigPath(
          path.join(path.dirname(CONFIG.CLAUDE.PATHS.SETTINGS), `settings_${agentName}.json`),
          configPath,
        );
        // Diagnostic: if settings_<agent>.json is missing at the expected path, log it
        // explicitly along with the alternative paths that DO exist. Without this log,
        // a user putting the file under .claude/agents/ (or just `agents/`) will see a
        // cryptic 401 ten minutes later with no breadcrumb back to the misplacement.
        if (!fs.existsSync(agentSettingsPath)) {
          const altPaths = [
            path.join(configPath, '.claude', 'agents', `settings_${agentName}.json`),
            path.join(configPath, `settings_${agentName}.json`),
            path.join(configPath, 'agents', `settings_${agentName}.json`),
          ];
          logger.warn(
            {
              agentName,
              searched: agentSettingsPath,
              alsoChecked: altPaths.filter((p) => fs.existsSync(p)),
            },
            'settings_<agent>.json not found at expected path. The agent will run with no LLM credentials unless ~/.hermes/.env or process.env provides them.',
          );
        }
        if (fs.existsSync(agentSettingsPath)) {
          // Read the RAW settings (pre-interpolation) to capture $VAR references
          // before they get resolved. We iterate the FULL TOKEN_KEYS list (100%
          // exhaustive) so any env-var name the runner knows about gets captured
          // for fail-loud validation later.
          const rawSettings = JSON.parse(fs.readFileSync(agentSettingsPath, 'utf8'));
          if (rawSettings.env) {
            for (const tk of TOKEN_KEYS) {
              const v = rawSettings.env[tk];
              if (v && typeof v === 'string' && v.length > 0) {
                rawExplicitSettingsTokens.push({ key: tk, value: v });
              }
            }
          }
          let settings = rawSettings;
          settings = interpolateEnvVars(settings);

          // Create temporary settings file
          const tempSettings = path.join(
            path.dirname(agentSettingsPath),
            `settings_${agentName}_tmp.json`,
          );
          fs.writeFileSync(tempSettings, JSON.stringify(settings, null, 2));
          tmpSettingsPath = tempSettings;
          this.tempFiles.push(tempSettings);

          if (settings.env) {
            Object.assign(agentCustomEnv, settings.env);
            if (!options.model && settings.env.MODEL) {
              agentCustomEnv.ANTHROPIC_MODEL = settings.env.MODEL;
            }
          }

          // MCP configurations
          const agentMcpPath = resolveConfigPath(
            path.join(path.dirname(CONFIG.CLAUDE.PATHS.SETTINGS), `.mcp.${agentName}.json`),
            configPath,
          );

          if (fs.existsSync(agentMcpPath)) {
            // Write temporary mcp path
            const tempMcp = path.join(
              path.dirname(agentSettingsPath),
              `mcp_${agentName}_tmp.json`,
            );
            fs.writeFileSync(tempMcp, fs.readFileSync(agentMcpPath, 'utf8'));
            tmpMcpPath = tempMcp;
            this.tempFiles.push(tempMcp);
          } else if (
            settings.enableAllProjectMcpServers === false &&
            Array.isArray(settings.enabledMcpjsonServers)
          ) {
            const projectMcpPath = resolveConfigPath(CONFIG.CLAUDE.PATHS.MCP, configPath);
            if (fs.existsSync(projectMcpPath)) {
              const fullMcp = JSON.parse(fs.readFileSync(projectMcpPath, 'utf8'));
              const filteredMcp: { mcpServers: Record<string, unknown> } = { mcpServers: {} };

              for (const serverName of settings.enabledMcpjsonServers) {
                if (fullMcp.mcpServers && fullMcp.mcpServers[serverName]) {
                  filteredMcp.mcpServers[serverName] = fullMcp.mcpServers[serverName];
                }
              }

              const tempMcp = path.join(
                path.dirname(agentSettingsPath),
                `mcp_${agentName}_tmp.json`,
              );
              fs.writeFileSync(tempMcp, JSON.stringify(filteredMcp, null, 2));
              tmpMcpPath = tempMcp;
              this.tempFiles.push(tempMcp);
            }
          }
        }
      } catch (e) {
        logger.warn({ error: e }, `Failed to process settings/mcp configurations for Hermes agent ${agentName}`);
      }

      // Load environment from isolated .env file (to allow overrides)
      const envPath = path.join(overmindHermesSubPath, '.env');
      if (fs.existsSync(envPath)) {
        try {
          const content = fs.readFileSync(envPath, 'utf8');
          content.split('\n').forEach((line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx === -1) return;
            const key = trimmed.slice(0, eqIdx).trim();
            let value = trimmed.slice(eqIdx + 1).trim();
            if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
            else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
            if (key) {
              agentCustomEnv[key] = value;
            }
          });
        } catch (e) {
          logger.warn({ envPath, error: e }, 'Failed to read agent env file');
        }
      }

      resolvedModel = agentCustomEnv.MODEL || agentCustomEnv.ANTHROPIC_MODEL;
      resolvedProvider = agentCustomEnv.PROVIDER || agentCustomEnv.ANTHROPIC_PROVIDER;
      if (resolvedProvider && (resolvedProvider.startsWith('http://') || resolvedProvider.startsWith('https://'))) {
        if (resolvedProvider.includes('minimax')) {
          resolvedProvider = 'minimax-cn';
        } else if (resolvedProvider.includes('z.ai') || resolvedProvider.includes('bigmodel')) {
          resolvedProvider = 'zai';
        } else {
          resolvedProvider = undefined;
        }
      }
    }

    const finalModel = options.model || resolvedModel || CONFIG.HERMES.DEFAULT_MODEL;
    const finalPrompt = systemPrompt ? `${systemPrompt}\n\n[USER QUERY]:\n${prompt}` : prompt;
    const cliPrompt = finalPrompt.length > 7000 ? finalPrompt.substring(0, 7000) : finalPrompt;

    // Build CLI args: chat -q (persistent session, NOT -z oneshot)
    // -z + --resume doesn't work — resume is ignored in oneshot mode
    const cleanArgs = ['chat', '-q', cliPrompt, '-Q'];
    cleanArgs.push('--model', finalModel);
    if (options.provider || resolvedProvider) {
      cleanArgs.push('--provider', options.provider || resolvedProvider!);
    }
    if (sessionId) cleanArgs.push('--resume', sessionId);

    // Token fallback setup (same as ClaudeRunner)
    const FALLBACK_KEYS = ['AUTH_FALLBACK_1', 'AUTH_FALLBACK_2', 'AUTH_FALLBACK_3'];

    // ============================================================
    // TOKEN PREFIX → PROVIDER MAPPING (Hermes v0.16.0)
    // ============================================================
    // The token PREFIX is the most reliable signal for the provider.
    // We detect it from the literal value, NOT from a hardcoded env-var name,
    // because the same env-var name (e.g. ANTHROPIC_AUTH_TOKEN) can be reused
    // across providers when the user copy-pastes keys from one service to another.
    //
    // Convention (observed in real .env files and provider dashboards):
    //   MiniMax     → "sk-cp-..."  → env MINIMAX_API_KEY  (or MINIMAX_CN_API_KEY)
    //   Z.AI / GLM  → "32hex.32hex"  → env ZAI_ANTHROPIC_FALLBACK_KEY  (or GLM_API_KEY)
    //                 e.g. "c78a134949fc4c369911c24e9fa4b84c.OZhHX5Obs6qF1ISt"
    //   Z.AI alt    → 32-char hex (single block, no dot)  → env ZAI_ANTHROPIC_FALLBACK_KEY
    //                 e.g. "5f650035e5a845549e4765184d8179b1"
    //   Anthropic   → "sk-ant-..." → env ANTHROPIC_AUTH_TOKEN
    //   OpenAI      → "sk-..."     → env OPENAI_API_KEY  (no -ant, no -cp)
    //   OpenRouter  → "sk-or-..."  → env OPENROUTER_API_KEY (BLOCKED for LLM)
    //   Mistral     → (variable)   → env MISTRAL_API_KEY_*
    //   Other       → unknown      → env ANTHROPIC_AUTH_TOKEN (default Anthropic)
    const TOKEN_PREFIX_PROVIDERS: Array<{ test: (t: string) => boolean; provider: string; envKey: string }> = [
      // Z.AI: c78a134949fc4c369911c24e9fa4b84c.OZhHX5Obs6qF1ISt (32hex.32hex — 2 blocks)
      { test: (t) => /^[0-9a-f]{32}\.[0-9a-zA-Z]+$/i.test(t), provider: 'zai', envKey: 'ZAI_ANTHROPIC_FALLBACK_KEY' },
      // Z.AI: 5f6500...q3m3 (32-char hex single block, no dot, no dashes)
      { test: (t) => /^[0-9a-f]{32}$/i.test(t), provider: 'zai', envKey: 'ZAI_ANTHROPIC_FALLBACK_KEY' },
      // MiniMax: sk-cp-...qNmo (with cp prefix)
      { test: (t) => t.startsWith('sk-cp-'), provider: 'minimax', envKey: 'MINIMAX_API_KEY' },
      // MiniMax: sk-mm-... (alternative prefix)
      { test: (t) => t.startsWith('sk-mm-'), provider: 'minimax', envKey: 'MINIMAX_API_KEY' },
      // Anthropic
      { test: (t) => t.startsWith('sk-ant-'), provider: 'anthropic', envKey: 'ANTHROPIC_AUTH_TOKEN' },
      // OpenRouter (BLOCKED for LLM, but we still detect it for diagnostic)
      { test: (t) => t.startsWith('sk-or-'), provider: 'openrouter', envKey: 'OPENROUTER_API_KEY' },
      // OpenAI (no -ant, no -cp, no -or)
      { test: (t) => t.startsWith('sk-'), provider: 'openai', envKey: 'OPENAI_API_KEY' },
      // Generic 16+ hex without dot — probably a Z.AI token variant
      { test: (t) => /^[0-9a-f]{16,}$/i.test(t), provider: 'zai', envKey: 'ZAI_ANTHROPIC_FALLBACK_KEY' },
    ];

    function detectTokenProvider(token: string): { provider: string; envKey: string } {
      for (const rule of TOKEN_PREFIX_PROVIDERS) {
        if (rule.test(token)) return { provider: rule.provider, envKey: rule.envKey };
      }
      return { provider: 'unknown', envKey: 'ANTHROPIC_AUTH_TOKEN' };
    }

    // ============================================================
    // TOKEN RESOLUTION ORDER (settings.env first, then process.env, then detection)
    // ============================================================
    // IMPORTANT — provider/credentials mapping (Hermes v0.16.0):
    //   minimax-cn  → MINIMAX_CN_API_KEY  (NOT ANTHROPIC_AUTH_TOKEN)
    //   minimax     → MINIMAX_API_KEY
    //   zai         → GLM_API_KEY or ZAI_ANTHROPIC_FALLBACK_KEY
    //   z-ai (alt)  → Z_AI_API_KEY
    //   anthropic   → ANTHROPIC_AUTH_TOKEN (any of _1.._5, _E, _F, _Y)
    //
    // The agent's settings_<name>.json MUST use the env var name that matches
    // its ANTHROPIC_PROVIDER value, otherwise Hermes upstream will silently
    // 401 even though Overmind has the key. The minimax plugin in Hermes
    // (plugins/model-providers/minimax/init.py) decides the env var name — not Overmind.
    //
    // Resolution order (NEW in 2.8.16+):
    //   1. settings_<agent>.json env block (explicit, agent-specific — WINS)
    //   2. agent's .hermes/.env (isolated override)
    //   3. process.env (global .env via systemd EnvironmentFile)
    //   4. Detection by token prefix (subtilisation — last resort, maps to right provider)
    //
    // (Full list moved to top of scope for use in RAW pre-interpolation capture.)
    // See const TOKEN_KEYS at top of runHermesAgent() function.

    /**
     * Resolve a token with explicit settings priority + provider detection.
     *
     * Strategy:
     *   1. Read settings_<agent>.json env block.
     *      - If user set a LITERAL token (e.g. "sk-cp-..."), use it directly.
     *      - If user set a $VAR REFERENCE (e.g. "$GLM_API_KEY_Y"), RESOLVE IT.
     *        - If $VAR is found in process.env → use the resolved value.
     *        - If $VAR is NOT found in process.env → FAIL LOUD. Do NOT silently
     *          fall back to TOKEN_KEYS (the user explicitly said "use THIS var").
     *      - If user set something else (e.g. template, expression), try to resolve.
     *   2. If no settings token (or settings has no env block at all), fall back
     *      to TOKEN_KEYS iteration in priority order from process.env.
     *   3. For each candidate, sniff the token prefix to know which provider it
     *      belongs to, and re-map to the right env var name for that provider.
     */
    function resolveTokenWithDetection(
      explicitSettingsTokens: Array<{ key: string; value: string }>,
    ): { tokenEnvKey: string; tokenValue: string; detectedProvider: string; source: 'settings-explicit' | 'env-fallback' | 'detected' } | null {
      // Step 1: settings_<agent>.json env block takes ABSOLUTE priority
      // (whatever the user explicitly set in their agent config wins)
      if (explicitSettingsTokens.length > 0) {
        const t = explicitSettingsTokens[0];
        // If the value is a $VAR reference, RESOLVE it against process.env
        let resolvedValue = t.value;
        if (typeof t.value === 'string' && t.value.startsWith('$')) {
          const varName = t.value.slice(1);
          const fromEnv = process.env[varName];
          if (!fromEnv || fromEnv.length === 0) {
            // FAIL LOUD — do not silently fall back. The user explicitly asked
            // for THIS var, and it doesn't exist. Surface the misconfiguration.
            logger.error(
              {
                agentName,
                requestedVar: varName,
                requestedKey: t.key,
                settingsPath: tmpSettingsPath,
              },
              '[FAIL-LOUD] settings_<agent>.json references $' + varName + ' but it is not set in process.env. ' +
              'Either export it in the parent .env, or fix the reference in settings_<agent>.json. ' +
              'Refusing to fall back to a different credential.',
            );
            throw new Error(
              `MISSING_ENV_VAR: settings_<agent>.json env.${t.key}="$` + varName + '" ' +
              `but process.env.${varName} is empty. Add it to /home/demon/.overmind/.env or fix the settings reference.`,
            );
          }
          resolvedValue = fromEnv;
          logger.info(
            { agentName, sourceKey: t.key, referencedVar: varName, resolvedLen: resolvedValue.length },
            '[SUBTILISATION] Resolved $VAR reference from settings_<agent>.json against process.env.',
          );
        }
        const detected = detectTokenProvider(resolvedValue);
        logger.info(
          { agentName, tokenKey: t.key, detectedProvider: detected.provider, mappedTo: detected.envKey },
          '[SUBTILISATION] Using explicit settings_<agent>.json token, re-mapping to detected provider env var.',
        );
        return { tokenEnvKey: t.key, tokenValue: resolvedValue, detectedProvider: detected.provider, source: 'settings-explicit' };
      }

      // Step 2: iterate TOKEN_KEYS in priority order, picking the first non-empty
      for (const tk of TOKEN_KEYS) {
        const v = agentCustomEnv[tk];
        if (v && typeof v === 'string' && v.length > 0) {
          const detected = detectTokenProvider(v);
          // If the env-var name doesn't match the detected provider, re-map.
          // (e.g. ANTHROPIC_AUTH_TOKEN=sk-cp-... → real env should be MINIMAX_API_KEY)
          if (detected.envKey !== tk && detected.provider !== 'unknown') {
            logger.info(
              { agentName, sourceKey: tk, detectedProvider: detected.provider, remappedTo: detected.envKey },
              '[SUBTILISATION] Token prefix detected provider mismatch — re-mapping env var.',
            );
            return { tokenEnvKey: detected.envKey, tokenValue: v, detectedProvider: detected.provider, source: 'detected' };
          }
          return { tokenEnvKey: tk, tokenValue: v, detectedProvider: detected.provider, source: 'env-fallback' };
        }
      }

      return null;
    }

    const getAvailableFallbacks = (): Array<{ key: string; value: string }> => {
      const fb: Array<{ key: string; value: string }> = [];
      for (const k of FALLBACK_KEYS) {
        const v = agentCustomEnv[k];
        if (v && typeof v === 'string' && v.length > 0) fb.push({ key: k, value: v });
      }
      return fb;
    };

    const getTokenForIndex = (idx: number): { tokenEnvKey: string; tokenValue: string } | null => {
      if (idx === 0) {
        // Use the RAW (pre-interpolation) settings tokens captured at load time.
        // This way, if the user set "$GLM_API_KEY_Y" in settings, we can detect
        // that it was a $VAR reference and fail-loud if it's not in process.env.
        // Reading tmpSettingsPath here would be too late (it's deleted by
        // cleanupTmpFiles() before this runs in some code paths).
        const explicitSettingsTokens = rawExplicitSettingsTokens;

        // The resolver may throw MISSING_ENV_VAR if a $VAR in settings is unresolved.
        // We catch and surface it as a clear NO_LLM_TOKEN error (the caller wraps it).
        const resolved = resolveTokenWithDetection(explicitSettingsTokens);
        if (resolved) return { tokenEnvKey: resolved.tokenEnvKey, tokenValue: resolved.tokenValue };

        // Diagnostic: dump which keys were checked and their (masked) state so a future
        // EXIT_CODE_1 + 401 has a clear breadcrumb back to the empty/missing credential.
        const probe = TOKEN_KEYS.map((tk) => {
          const v = agentCustomEnv[tk];
          if (typeof v !== 'string' || v.length === 0) return `${tk}=<empty>`;
          return `${tk}=<set len=${v.length}>`;
        });
        logger.error(
          { agentName, checked: probe, settingsPath: tmpSettingsPath, envFile: path.join(overmindHermesSubPath, '.env') },
          'No usable LLM token found. Check settings_<agent>.json env block and the agent .hermes/.env file.',
        );
        return null;
      }
      const fb = getAvailableFallbacks();
      return fb[idx - 1] ? { tokenEnvKey: fb[idx - 1].key, tokenValue: fb[idx - 1].value } : null;
    };

    const isRetryableError = (stderr: string): boolean => {
      const lower = stderr.toLowerCase();
      return lower.includes('401') || lower.includes('unauthorized') ||
        lower.includes('invalid api key') || lower.includes('authentication failed') ||
        lower.includes('invalid authentication') || lower.includes('429') ||
        lower.includes('rate limit') || lower.includes('quota exhausted') ||
        lower.includes('limit exhausted') || lower.includes('503') ||
        lower.includes('service unavailable') || lower.includes('500') ||
        lower.includes('internal server error');
    };

    // HERMES_HOME setup
    if (!fs.existsSync(overmindHermesSubPath)) fs.mkdirSync(overmindHermesSubPath, { recursive: true });
    agentCustomEnv.HERMES_HOME = overmindHermesSubPath;
    if (process.platform === 'win32') agentCustomEnv.USERPROFILE = overmindHermesPath;
    else agentCustomEnv.HOME = overmindHermesPath;

    // Write .env to HERMES_HOME (credential auto-discovery) - Cleaned to prevent duplicates
    // EXCLUDE all OpenRouter keys — OpenRouter is managed internally by Overmind, Hermes must never see it
    const credRegex = /(?:api_key|auth_token|base_url|endpoint|url)$/i;
    const openRouterPrefixes = ['OPENROUTER', 'OVERMIND_EMBEDDING'];
    const envMap = new Map<string, string>();
    const dotPath = path.join(overmindHermesSubPath, '.env');
    if (fs.existsSync(dotPath)) {
      try {
        const existing = fs.readFileSync(dotPath, 'utf8');
        existing.split('\n').forEach((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx === -1) return;
          const k = trimmed.slice(0, eqIdx).trim();
          let v = trimmed.slice(eqIdx + 1).trim();
          if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
          else if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
          if (k) {
            if (openRouterPrefixes.some(p => k.toUpperCase().startsWith(p))) return;
            envMap.set(k, v);
          }
        });
      } catch (e) {
        logger.warn({ envPath: dotPath, error: e }, 'Failed to read existing agent env file for deduplication');
      }
    }
    for (const [k, v] of Object.entries(agentCustomEnv)) {
      if (typeof v === 'string' && v.length > 0 && credRegex.test(k)) {
        if (openRouterPrefixes.some(p => k.toUpperCase().startsWith(p))) continue;
        envMap.set(k, v);
      }
    }
    const finalDotEntries: string[] = [];
    for (const [k, v] of envMap.entries()) {
      finalDotEntries.push(`${k}=${v}`);
    }
    fs.writeFileSync(dotPath, finalDotEntries.join('\n') + '\n', 'utf8');

    // Generate config.yaml in HERMES_HOME (MCP servers)
    if (tmpMcpPath && fs.existsSync(tmpMcpPath)) {
      try {
        const mc = JSON.parse(fs.readFileSync(tmpMcpPath, 'utf8'));
        const yamlPath = path.join(overmindHermesSubPath, 'config.yaml');
        // Preserve existing config.yaml (tts, llm, etc.) — merge mcp_servers only
        let existingYaml = '';
        if (fs.existsSync(yamlPath)) {
          existingYaml = fs.readFileSync(yamlPath, 'utf8');
        }
        // Build new mcp_servers section
        let newMcpSection = 'mcp_servers:\n';
        for (const [name, srv] of Object.entries(mc.mcpServers || {})) {
          const s = srv as Record<string, unknown>;
          newMcpSection += `  ${name}:\n`;
          if (s.url) newMcpSection += `    url: "${s.url}"\n`;
          if (s.command) newMcpSection += `    command: "${s.command}"\n`;
        }
        // Merge: replace mcp_servers block in existing yaml or append
        let finalYaml: string;
        if (existingYaml.includes('mcp_servers:')) {
          finalYaml = existingYaml.replace(/mcp_servers:\n([\s\S]*?)(?=\n\w|\n$|$)/, newMcpSection.trimEnd() + '\n');
        } else {
          finalYaml = existingYaml.trimEnd() + '\n' + newMcpSection;
        }
        fs.writeFileSync(yamlPath, finalYaml, 'utf8');
        if (!silent) console.error(`[NousHermesRunner] MCP config.yaml written to ${yamlPath}`);
      } catch (e) { console.error(`[NousHermesRunner] config.yaml error: ${e}`); }
    }

    // AbortSignal
    if (options.signal?.aborted) return Promise.reject(new Error('ABORTED'));
    let currentChildRef: ChildProcess | null = null;

    return new Promise((resolve) => {
      let resolved = false;
      let retryCount = 0;
      const maxRetries = getAvailableFallbacks().length + 1;
      let currentSessionId: string | undefined = sessionId;

      const safeResolve = (v: RunAgentResult) => { if (!resolved) { resolved = true; resolve(v); } };

      const cleanupTmpFiles = () => {
        for (const f of [tmpSettingsPath, tmpMcpPath]) {
          if (f && fs.existsSync(f)) { try { fs.unlinkSync(f); } catch { /* ignored */ } }
        }
      };

      const writeAuthJson = (tokenInfo: { tokenEnvKey: string; tokenValue: string } | null) => {
        if (!tokenInfo || !overmindHermesSubPath) return;
        try {
          const authPath = path.join(overmindHermesSubPath, 'auth.json');
          const auth: Record<string, unknown> = { version: 1, providers: {}, credential_pool: {} };
          if (fs.existsSync(authPath)) Object.assign(auth, JSON.parse(fs.readFileSync(authPath, 'utf8')));
          if (!auth.credential_pool) auth.credential_pool = {};
          const cleanCp = auth.credential_pool as Record<string, unknown[]>;
          // Determine effective provider from MULTIPLE signals
          // Priority: TOKEN PREFIX (most reliable) > BASE_URL (very reliable) > settings.ANTHROPIC_PROVIDER (hint only)
          // The user can put anything in settings.ANTHROPIC_PROVIDER — we don't blindly trust it.
          const baseUrlHint = agentCustomEnv['ANTHROPIC_BASE_URL'] || agentCustomEnv['GLM_BASE_URL'] || '';
          // First, detect from token prefix
          const detectedFromToken = detectTokenProvider(tokenInfo.tokenValue);
          // Then, detect from base URL
          let detectedFromUrl: string | null = null;
          if (baseUrlHint) {
            const url = baseUrlHint.toLowerCase();
            if (url.includes('minimax')) {
              if (url.includes('.cn') || url.includes('minimaxi')) detectedFromUrl = 'minimax-cn';
              else detectedFromUrl = 'minimax';
            } else if (url.includes('z.ai') || url.includes('bigmodel') || url.includes('zhipu')) {
              detectedFromUrl = 'zai';
            } else if (url.includes('anthropic.com')) {
              detectedFromUrl = 'anthropic';
            } else if (url.includes('openai.com')) {
              detectedFromUrl = 'openai';
            }
          }
          // Then, the hint from settings
          const settingsHint = resolvedProvider || '';

          // Voting: token > URL > settings
          let effectiveProvider: string;
          if (detectedFromToken.provider !== 'unknown') {
            effectiveProvider = detectedFromToken.provider;
            if (settingsHint && settingsHint !== effectiveProvider) {
              logger.warn(
                { agentName, settingsHint, tokenSays: effectiveProvider, urlSays: detectedFromUrl },
                '[SUBTILISATION] settings.ANTHROPIC_PROVIDER contradicts token prefix — using token.',
              );
            }
          } else if (detectedFromUrl) {
            effectiveProvider = detectedFromUrl;
            if (settingsHint && settingsHint !== effectiveProvider) {
              logger.warn(
                { agentName, settingsHint, urlSays: effectiveProvider, tokenSays: detectedFromToken.provider },
                '[SUBTILISATION] settings.ANTHROPIC_PROVIDER contradicts BASE_URL — using URL.',
              );
            }
          } else if (settingsHint) {
            effectiveProvider = settingsHint;
          } else {
            effectiveProvider = 'zai';
          }
          cleanCp[effectiveProvider] = [{
            id: `${effectiveProvider}-default`, label: tokenInfo.tokenEnvKey, auth_type: 'api_key',
            priority: 0, source: `env:${tokenInfo.tokenEnvKey}`, access_token: tokenInfo.tokenValue,
            last_status: null, last_error_code: null,
            base_url: baseUrlHint || 'https://api.z.ai/api/coding/paas/v4',
            request_count: 0,
          }];
          fs.writeFileSync(authPath, JSON.stringify(auth, null, 2), 'utf8');

          // ============================================================
          // Write .env for HERMES_HOME — emit the 4 canonical fields
          // Hermes needs: ANTHROPIC_MODEL, ANTHROPIC_AUTH_TOKEN,
          //               ANTHROPIC_PROVIDER, ANTHROPIC_BASE_URL
          // ============================================================
          const dotEnvPath = path.join(overmindHermesSubPath, '.env');
          const dotLines: string[] = [];

          // 1. ANTHROPIC_MODEL (always — Hermes needs it)
          if (finalModel) {
            dotLines.push(`ANTHROPIC_MODEL=${finalModel}`);
          }

          // 2. ANTHROPIC_PROVIDER (the kebab-case provider name)
          dotLines.push(`ANTHROPIC_PROVIDER=${effectiveProvider}`);

          // 3. ANTHROPIC_BASE_URL (from settings, or fallback)
          const resolvedBaseUrl = baseUrlHint || 'https://api.z.ai/api/coding/paas/v4';
          dotLines.push(`ANTHROPIC_BASE_URL=${resolvedBaseUrl}`);

          // 4. ANTHROPIC_AUTH_TOKEN = literal token value
          // (Hermes reads this env var directly — no more provider-specific mapping)
          dotLines.push(`ANTHROPIC_AUTH_TOKEN=${tokenInfo.tokenValue}`);

          // 5. ALSO seed the provider-specific env var for plugins that need it
          //    (e.g. minimax plugin reads MINIMAX_API_KEY directly)
          if (effectiveProvider === 'minimax' || effectiveProvider === 'minimax-cn') {
            dotLines.push(`MINIMAX_API_KEY=${tokenInfo.tokenValue}`);
            if (effectiveProvider === 'minimax-cn') {
              dotLines.push(`MINIMAX_CN_API_KEY=${tokenInfo.tokenValue}`);
            }
          } else if (effectiveProvider === 'zai' || effectiveProvider === 'z-ai') {
            dotLines.push(`GLM_API_KEY=${tokenInfo.tokenValue}`);
            dotLines.push(`ZAI_ANTHROPIC_FALLBACK_KEY=${tokenInfo.tokenValue}`);
          } else if (effectiveProvider === 'openai') {
            dotLines.push(`OPENAI_API_KEY=${tokenInfo.tokenValue}`);
          } else if (effectiveProvider === 'anthropic') {
            // ANTHROPIC_AUTH_TOKEN already set above
          }

          fs.writeFileSync(dotEnvPath, dotLines.join('\n') + '\n', 'utf8');
          logger.info(
            { agentName, effectiveProvider, baseUrl: resolvedBaseUrl, model: finalModel, sourceKey: tokenInfo.tokenEnvKey, detectedProvider: detectedFromToken.provider },
            '[AUTH] Wrote agent .env with 4 canonical Hermes fields + provider-specific seeds.',
          );
        } catch (e) {
          logger.warn({ error: e, agentName }, '[AUTH] Failed to write auth.json or agent .env');
        }
      };

      const spawnHermes = async (tokenInfo: { tokenEnvKey: string; tokenValue: string } | null) => {
        const spawnEnv: Record<string, string> = { ...process.env as Record<string, string>, ...agentCustomEnv as Record<string, string> };
        if (tokenInfo) {
          for (const tk of TOKEN_KEYS) delete spawnEnv[tk];
          let resolvedToken = tokenInfo.tokenValue;
          if (resolvedToken.startsWith('$')) resolvedToken = process.env[resolvedToken.slice(1)] || resolvedToken;
          spawnEnv[tokenInfo.tokenEnvKey] = resolvedToken;
        }
         writeAuthJson(tokenInfo);

        // BLOCK: OpenRouter is for embeddings only — never pass to Hermes for LLM inference
        delete spawnEnv['OPENROUTER_API_KEY'];
        delete spawnEnv['OPENROUTER_BASE_URL'];
        delete spawnEnv['OVERMIND_EMBEDDING_KEY'];

        const hermesBin = await findHermesBinary();
        const isWin = process.platform === 'win32';
        const venvRoot = process.env.HERMES_AGENT_ROOT
          || (isWin
            ? path.join(process.env.LOCALAPPDATA || '', 'hermes', 'hermes-agent', 'venv')
            : path.join(process.env.HOME || '', '.local', 'share', 'hermes-agent', 'venv'));
        // Only override VIRTUAL_ENV/PATH when hermes actually lives inside a venv
        // (i.e. <venv>/bin/hermes or <venv>/Scripts/hermes.exe). If the binary is a
        // system install (e.g. /usr/local/bin/hermes), leave the parent PATH alone.
        const venvBin = isWin ? path.join(venvRoot, 'Scripts') : path.join(venvRoot, 'bin');
        const isVenvInstall = hermesBin.startsWith(venvBin + path.sep) || hermesBin === venvBin;
        const pathSep = isWin ? ';' : ':';
        const child: ChildProcess = spawn(hermesBin, cleanArgs, {
          cwd, shell: false, windowsHide: true,
          env: {
            ...spawnEnv,
            HERMES_HOME: overmindHermesSubPath,
            ...(isVenvInstall
              ? {
                  VIRTUAL_ENV: venvRoot,
                  PATH: `${venvRoot}${isWin ? ';' : ':'}${venvBin}${pathSep}${process.env.PATH || ''}`,
                }
              : {}),
          },
        });
        currentChildRef = child;

        if (child.pid) {
          void registerProcess(child.pid, { agentName: agentName || '', runner: 'hermes', configPath });
          void registerLiveAgent({
            pid: child.pid, runner: 'hermes', agentName: agentName || '',
            sessionId: currentSessionId || '',
            cleanupFn: async () => { await killProcessTree(child); },
            childRef: child,
          });
          child.once('exit', (code) => {
            setLiveStatus(child.pid!, code === 0 ? 'done' : 'failed', code ?? null);
            void unregisterLiveAgent(child.pid!);
          });
        }

        let stdout = ''; let stderr = '';
        child.stdout?.on('data', (d: Buffer) => {
          const chunk = d.toString();
          if (child.pid) { void appendOutput(child.pid, chunk, configPath); void appendLiveOutput(child.pid, chunk); }
          if (stdout.length + chunk.length > MAX_BUF) stdout = stdout.slice(-MAX_BUF); else stdout += chunk;
          if (!silent && agentName) process.stderr.write(`[Hermes:${agentName}] ${chunk}`);
        });
        child.stderr?.on('data', (d: Buffer) => {
          const chunk = d.toString();
          if (stderr.length + chunk.length > MAX_BUF) stderr = stderr.slice(-MAX_BUF); else stderr += chunk;
          if (!silent && agentName) process.stderr.write(`[Hermes:${agentName}:ERR] ${chunk}`);
        });

        const timer = setTimeout(() => {
          if (child.stdin && !child.stdin.destroyed) { try { child.stdin.write('\n'); } catch { /* ignore */ } }
          setTimeout(async () => {
            await killProcessTree(child);
            cleanupTmpFiles();
            safeResolve({ result: '', error: 'HARD_TIMEOUT', rawOutput: stdout + stderr });
          }, HARD_TIMEOUT_MS);
        }, timeoutMs);

        child.on('close', async (code: number | null) => {
          clearTimeout(timer);
          if (child.pid) void updateProcessStatus(child.pid, code === 0 ? 'done' : 'failed', code, configPath);

          const sessionMatch = stdout.match(/session_id:\s*(\S+)/i) || 
                               stderr.match(/session_id:\s*(\S+)/i) || 
                               stdout.match(/Session:\s*(\S+)/) || 
                               stderr.match(/Session:\s*(\S+)/);
          if (sessionMatch) currentSessionId = sessionMatch[1];


          const retryable = isRetryableError(stderr) || isRetryableError(stdout);
          if (code !== 0 && retryable && retryCount < maxRetries) {
            retryCount++;
            const ti = getTokenForIndex(retryCount);
            if (!silent) {
              process.stderr.write(`\n\x1b[41m\x1b[37m[NousHermesRunner] Retry ${retryCount}/${maxRetries} avec ${ti?.tokenEnvKey || 'UNKNOWN'}...\x1b[0m\n`);
            }
            await killProcessTree(child);
            setImmediate(() => spawnHermes(ti));
            return;
          }

          cleanupTmpFiles();
          if (currentSessionId && agentName) {
            await saveSessionId(agentName, currentSessionId, configPath, 'hermes');
            if (child.pid) void linkSessionToPid(currentSessionId, child.pid, configPath);
          }

          if (code !== 0 && !stdout.trim()) {
            safeResolve({ result: '', error: `EXIT_CODE_${code}`, rawOutput: stderr || stdout, sessionId: currentSessionId });
            return;
          }
          safeResolve({ result: stdout.trim(), sessionId: currentSessionId, rawOutput: stdout });
        });

        child.on('error', (err: Error) => {
          clearTimeout(timer);
          killProcessTree(child).then(() => {
            cleanupTmpFiles();
            safeResolve({ result: '', error: `SPAWN_ERROR: ${err.message}`, rawOutput: '' });
          });
        });
      };

      options.signal?.addEventListener('abort', () => {
        if (currentChildRef) killProcessTree(currentChildRef).then(() => {
          cleanupTmpFiles();
          safeResolve({ result: '', error: 'ABORTED', rawOutput: '' });
        });
      });

      let firstToken: { tokenEnvKey: string; tokenValue: string } | null;
      try {
        firstToken = getTokenForIndex(0);
      } catch (e) {
        // getTokenForIndex throws MISSING_ENV_VAR when settings_<agent>.json references
        // a $VAR that doesn't exist in process.env. Surface it as a clear error.
        const msg = e instanceof Error ? e.message : String(e);
        logger.error({ agentName, error: msg }, '[NO_LLM_TOKEN] Token resolution failed.');
        safeResolve({
          result: '',
          error: `NO_LLM_TOKEN: ${msg}`,
          rawOutput: '',
        });
        return;
      }
      if (!firstToken && agentName) {
        // No credential was resolved at all — refuse to spawn hermes with an empty
        // API key (which would silently 401 and report the misleading EXIT_CODE_1).
        // The diagnostic log inside getTokenForIndex(0) already lists the checked keys.
        const settingsHint = tmpSettingsPath
          ? `Look at ${tmpSettingsPath} (env block) and ${path.join(overmindHermesSubPath, '.env')}.`
          : `No settings_${agentName}.json was loaded. Check the .claude/ folder.`;
        safeResolve({
          result: '',
          error: `NO_LLM_TOKEN: settings_<agent>.json env block is empty or missing required keys (${TOKEN_KEYS.join(', ')}). ${settingsHint}`,
          rawOutput: '',
        });
        return;
      }
      spawnHermes(firstToken);
    });
  }
}
