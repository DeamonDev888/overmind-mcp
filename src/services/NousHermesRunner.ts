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
      // GLM_API_KEY in spawn env — zai provider resolves credentials via os.environ.get("GLM_API_KEY")
      // before checking .env files. This is the most reliable path for Z.AI tokens.
      ...(agentName && false ? { GLM_API_KEY: '' } : {}),
    };

    let tmpSettingsPath: string | null = null;
    let tmpMcpPath: string | null = null;

    if (agentName) {
      const settingsDir = path.dirname(CONFIG.HERMES.PATHS.SETTINGS);
      const agentSettingsPath = resolveConfigPath(
        path.join(settingsDir, `settings_${agentName}.json`), configPath,
      );

      if (!fs.existsSync(agentSettingsPath)) {
        return { result: '', error: `INVALID_AGENT: Agent Hermes "${agentName}" non trouvé.` };
      }

      const settings = interpolateEnvVars(JSON.parse(fs.readFileSync(agentSettingsPath, 'utf8')));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = settings as Record<string, any>;

      tmpSettingsPath = path.join(path.dirname(agentSettingsPath), `settings_${agentName}_tmp.json`);
      fs.writeFileSync(tmpSettingsPath, JSON.stringify(s, null, 2), 'utf8');

      if (!options.model && typeof s.model === 'string') resolvedModel = s.model;
      if (!options.model && s.env?.ANTHROPIC_MODEL && !String(s.env.ANTHROPIC_MODEL).startsWith('$')) {
        resolvedModel = s.env.ANTHROPIC_MODEL;
      }
      if (!options.provider && s.env?.ANTHROPIC_PROVIDER && !String(s.env.ANTHROPIC_PROVIDER).startsWith('$')) {
        resolvedProvider = s.env.ANTHROPIC_PROVIDER;
      }
      if (s.env) {
        for (const [k, v] of Object.entries(s.env)) {
          if (typeof v === 'string') agentCustomEnv[k] = v;
        }
      }

      const agentPromptPath = resolveConfigPath(
        path.join(settingsDir, 'agents', `${agentName}.md`), configPath,
      );
      if (fs.existsSync(agentPromptPath)) {
        systemPrompt = fs.readFileSync(agentPromptPath, 'utf8');
      }

      // MCP config filtered by enabledMcpjsonServers
      const agentMcpPath = resolveConfigPath(
        path.join(settingsDir, `.mcp.${agentName}.json`), configPath,
      );
      if (fs.existsSync(agentMcpPath)) {
        try {
          const mcpConfig = interpolateEnvVars(JSON.parse(fs.readFileSync(agentMcpPath, 'utf8')));
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const mc = mcpConfig as Record<string, any>;
          const filteredMcp: Record<string, unknown> = { mcpServers: {} };
          const enabled = s.enabledMcpjsonServers || [];
          for (const sn of enabled) {
            if (mc.mcpServers?.[sn]) {
              (filteredMcp.mcpServers as Record<string, unknown>)[sn] = mc.mcpServers[sn];
            }
          }
          tmpMcpPath = path.join(path.dirname(agentMcpPath), `mcp_${agentName}_tmp.json`);
          fs.writeFileSync(tmpMcpPath, JSON.stringify(filteredMcp, null, 2), 'utf8');
        } catch (e) { console.error(`[NousHermesRunner] MCP config error: ${e}`); }
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
    const TOKEN_KEYS = ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_AUTH_TOKEN_E', 'GLM_API_KEY', 'Z_AI_API_KEY'];

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
        for (const tk of TOKEN_KEYS) {
          const v = agentCustomEnv[tk];
          if (v && typeof v === 'string' && v.length > 0) return { tokenEnvKey: tk, tokenValue: v };
        }
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
    const overmindHermesPath = path.resolve(cwd, '.overmind', 'hermes', agentName ? `agent_${agentName}` : 'central');
    const overmindHermesSubPath = path.join(overmindHermesPath, '.hermes');
    if (!fs.existsSync(overmindHermesSubPath)) fs.mkdirSync(overmindHermesSubPath, { recursive: true });
    agentCustomEnv.HERMES_HOME = overmindHermesSubPath;
    if (process.platform === 'win32') agentCustomEnv.USERPROFILE = overmindHermesPath;
    else agentCustomEnv.HOME = overmindHermesPath;

    // Write .env to HERMES_HOME (credential auto-discovery)
    // EXCLUDE all OpenRouter keys — OpenRouter is managed internally by Overmind, Hermes must never see it
    const credRegex = /(?:api_key|auth_token|base_url|endpoint|url)$/i;
    const openRouterPrefixes = ['OPENROUTER', 'OVERMIND_EMBEDDING'];
    const dotEntries: string[] = [];
    for (const [k, v] of Object.entries(agentCustomEnv)) {
      if (typeof v === 'string' && v.length > 0 && credRegex.test(k)) {
        // Skip ALL openrouter/overmind-embedding keys — handled internally by Overmind
        if (openRouterPrefixes.some(p => k.toUpperCase().startsWith(p))) continue;
        dotEntries.push(`${k}=${v}`);
      }
    }
    if (dotEntries.length > 0) {
      const dotPath = path.join(overmindHermesSubPath, '.env');
      fs.writeFileSync(dotPath, dotEntries.join('\n') + '\n', 'utf8');
    }

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
          const cp = auth.credential_pool as Record<string, unknown[]>;
          // Reset credential_pool to ONLY zai — openrouter is for embeddings only, never for LLM inference
          auth.credential_pool = {};
          const cleanCp = auth.credential_pool as Record<string, unknown[]>;
          cleanCp['zai'] = [{
            id: 'zai-default', label: tokenInfo.tokenEnvKey, auth_type: 'api_key',
            priority: 0, source: `env:${tokenInfo.tokenEnvKey}`, access_token: tokenInfo.tokenValue,
            last_status: null, last_error_code: null,
            base_url: agentCustomEnv['GLM_BASE_URL'] || 'https://api.z.ai/api/coding/paas/v4',
            request_count: 0,
          }];
          fs.writeFileSync(authPath, JSON.stringify(auth, null, 2), 'utf8');
        } catch (_e) { /* non-critical */ }
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
        const child: ChildProcess = spawn(hermesBin, cleanArgs, {
          cwd, shell: false, windowsHide: true,
          env: {
            ...spawnEnv,
            HERMES_HOME: overmindHermesSubPath,
            VIRTUAL_ENV: process.env.HERMES_AGENT_ROOT
              ? path.join(process.env.HERMES_AGENT_ROOT, 'venv')
              : path.join(process.env.LOCALAPPDATA || '', 'hermes', 'hermes-agent', 'venv'),
            PATH: `${process.env.HERMES_AGENT_ROOT || path.join(process.env.LOCALAPPDATA || '', 'hermes', 'hermes-agent', 'venv')};${process.env.PATH || ''}`,
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

          const sessionMatch = stdout.match(/Session:\s+(\S+)/);
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

      spawnHermes(getTokenForIndex(0));
    });
  }
}
