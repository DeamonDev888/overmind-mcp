/**
 * GeminiRunner — Exécute des agents IA via Antigravity CLI
 * 
 * NOTE: "gemini" dans run_agent = Antigravity runner.
 * L'ancien gemini-cli (@google/gemini-cli npm) est remplacé.
 * 
 * Antigravity CLI est le runner natif de Google, bundlé dans Antigravity IDE.
 * Différences avec l'ancien gemini-cli:
 * - CLI bundlé dans Antigravity IDE (pas npm)
 * - Auth via OAuth interne (pas de sync .gemini/)
 * - Config locale .antigravity/<agent>/ (pas .overmind/gemini/)
 * - Modes: GENERAL, CONTEXT_CHECK, PLAN, COMMAND, CASCADE, EVAL, etc.
 */

import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { CONFIG, resolveConfigPath } from '../lib/config.js';
import { getLastSessionId, saveSessionId } from '../lib/sessions.js';
import { interpolateEnvVars } from '../lib/envUtils.js';
import { withSpan, type Span } from '../lib/telemetry.js';
import { loadEnvQuietly } from '../lib/loadEnv.js';
import pino from 'pino';
import {
  registerProcess,
  linkSessionToPid,
  appendOutput,
  updateProcessStatus,
  killProcessTree,
} from '../lib/processRegistry.js';

const logger = pino({ name: 'GeminiRunner' });

// ============================================================================
// CHEMINS ANTIGRAVITY (remplace gemini-cli npm)
// ============================================================================

/** Dossier d'installation d'Antigravity IDE */
const ANTIGRAVITY_IDE_PATH = path.join(
  process.env.LOCALAPPDATA || '',
  'Programs',
  'Antigravity IDE'
);

/** CLI Antigravity (Electron wrapper) */
const ANTIGRAVITY_CLI_EXE = path.join(
  ANTIGRAVITY_IDE_PATH,
  'Antigravity IDE.exe'
);

/** Resources/app pour les outils internes */
const ANTIGRAVITY_RESOURCES_APP = path.join(
  ANTIGRAVITY_IDE_PATH,
  'resources',
  'app'
);

/** Language server pour les opérations de code */
const ANTIGRAVITY_LANGUAGE_SERVER = path.join(
  ANTIGRAVITY_RESOURCES_APP,
  'bin',
  'language_server_windows_x64.exe'
);

/** Dossier .antigravity local par agent */
function getAgentAntigravityDir(agentName?: string, configPath?: string): string {
  const baseDir = configPath || process.cwd();
  return path.resolve(
    baseDir,
    '.antigravity',
    agentName ? `agent_${agentName}` : 'default'
  );
}

/**
 * Vérifie si Antigravity IDE est installé
 */
export function isAntigravityInstalled(): boolean {
  return fs.existsSync(ANTIGRAVITY_CLI_EXE);
}

// ============================================================================
// TYPES (identiques à l'ancien GeminiRunner)
// ============================================================================

export interface RunAgentOptions {
  prompt: string;
  agentName?: string;
  sessionId?: string;
  autoResume?: boolean;
  cwd?: string;
  configPath?: string;
  silent?: boolean;
  model?: string;
  /** Mode Antigravity (défaut: GENERAL) */
  mode?: 'GENERAL' | 'CONTEXT_CHECK' | 'PLAN' | 'COMMAND' | 'CASCADE' | 'EVAL' | 'ANTIGRAVITY_REVIEW' | 'MQUERY' | 'COMMIT_MESSAGE' | 'CHECKPOINT' | 'FAST_APPLY';
}

export interface RunAgentResult {
  result: string;
  sessionId?: string;
  error?: string;
  rawOutput?: string;
  model?: string;
  nickname?: string;
  fallbackUsed?: string;
}

// ============================================================================
// GEMINIRUNNER (MAIS EN FAIT ANTIGRAVITY)
// ============================================================================

export class GeminiRunner {
  private config: typeof CONFIG.CLAUDE;
  private timeoutMs: number;
  private tempFiles: string[] = [];

  constructor() {
    this.config = CONFIG.CLAUDE;
    this.timeoutMs = CONFIG.TIMEOUT_MS || 900000; // 15 min default
  }

  private cleanupTempFiles(): void {
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
    // Load .env files first (before anything else) — same as before
    const cwd = options.cwd || process.cwd();
    loadEnvQuietly(path.join(cwd, '.env'));
    loadEnvQuietly(path.join(cwd, '../Workflow/.env'));

    const { prompt, agentName, autoResume, mode = 'GENERAL' } = options;
    let { sessionId } = options;
    const { PATHS } = this.config;

    // ========================================================================
    // VÉRIFICATION ANTIGRAVITY (remplace gemini-cli check)
    // ========================================================================

    if (!isAntigravityInstalled()) {
      return {
        result: '',
        error: 'ANTIGRAVITY_NOT_INSTALLED: Antigravity IDE non trouvé.\nInstallez depuis: C:\\Users\\Deamon\\AppData\\Local\\Programs\\Antigravity IDE\\Antigravity IDE.exe',
      };
    }

    // ========================================================================
    // ENV + SESSION
    // ========================================================================

    const agentCustomEnv: Record<string, string | undefined> = {
      ...process.env,
      ...(agentName ? { OVERMIND_AGENT_NAME: agentName } : {}),
    };

    // Auto Resume
    if (autoResume && agentName && !sessionId) {
      const lastId = await getLastSessionId(agentName, options.configPath, 'gemini');
      if (lastId) {
        sessionId = lastId;
      }
    }

    // ========================================================================
    // SYSTEM PROMPT LOADING
    // ========================================================================

    let finalPrompt = prompt;
    if (agentName) {
      try {
        const settingsDir = path.dirname(PATHS.SETTINGS);
        let agentPromptPath = resolveConfigPath(
          path.join(settingsDir, 'agents', `${agentName}.md`),
          options.configPath,
        );

        if (!fs.existsSync(agentPromptPath)) {
          agentPromptPath = resolveConfigPath(
            path.join(path.dirname(settingsDir), 'agents', `${agentName}.md`),
            options.configPath,
          );
        }
        if (fs.existsSync(agentPromptPath)) {
          const systemPrompt = fs.readFileSync(agentPromptPath, 'utf8');
          finalPrompt = `${systemPrompt}\n\n[USER QUERY]:\n${prompt}`;
        }
      } catch (err) {
        logger.warn({ agentName, error: err }, 'Failed to load agent prompt, using raw prompt');
      }
    }

    // ========================================================================
    // ANTIGRAVITY CONFIG (remplace la sync .gemini/ du vieux gemini-cli)
    // ========================================================================

    const agentAntigravityDir = getAgentAntigravityDir(agentName, options.configPath);

    // Créer le dossier .antigravity/<agent> si nécessaire
    if (!fs.existsSync(agentAntigravityDir)) {
      fs.mkdirSync(agentAntigravityDir, { recursive: true });
    }

    // NOTE: Antigravity utilise son propre OAuth interne (pas de sync creds nécessaire)
    // Contrairement à l'ancien gemini-cli qui syncait .gemini/ depuis HOME

    // ========================================================================
    // MCP CONFIG (identique à avant)
    // ========================================================================

    const mcpPath = path.join(agentAntigravityDir, 'mcp.json');

    if (agentName) {
      const settingsDir = path.dirname(PATHS.SETTINGS);
      const agentSettingsPath = resolveConfigPath(
        path.join(settingsDir, `settings_${agentName}.json`),
        options.configPath,
      );

      if (fs.existsSync(agentSettingsPath)) {
        let settings = JSON.parse(fs.readFileSync(agentSettingsPath, 'utf8'));

        // --- Interpolation des variables d'environnement ---
        settings = interpolateEnvVars(settings);

        if (settings.env) {
          Object.assign(agentCustomEnv, settings.env);
        }

        // Copier le MCP config si existant
        const originalMcpPath = resolveConfigPath(PATHS.MCP, options.configPath);
        if (fs.existsSync(originalMcpPath)) {
          const fullMcp = JSON.parse(fs.readFileSync(originalMcpPath, 'utf8'));
          let mcpToUse = fullMcp;

          if (
            settings.enableAllProjectMcpServers === false &&
            Array.isArray(settings.enabledMcpjsonServers)
          ) {
            const filteredMcp: { mcpServers: Record<string, unknown> } = { mcpServers: {} };
            for (const serverName of settings.enabledMcpjsonServers) {
              if (fullMcp.mcpServers && fullMcp.mcpServers[serverName]) {
                filteredMcp.mcpServers[serverName] = fullMcp.mcpServers[serverName];
              }
            }
            mcpToUse = filteredMcp;
          }

          fs.writeFileSync(mcpPath, JSON.stringify(mcpToUse, null, 2));
          this.tempFiles.push(mcpPath); // Track for cleanup
          logger.info({ mcpPath }, 'MCP configuration synchronized for Antigravity');
          if (!options.silent) {
            process.stderr.write(`[GeminiRunner] MCP synchronisé: ${mcpPath}\n`);
          }
        }
      }
    }

    // ========================================================================
    // SPAWN ANTIGRAVITY CLI (remplace spawn gemini.js)
    // ========================================================================

    const command = ANTIGRAVITY_LANGUAGE_SERVER;
    const argsSpawn: string[] = [];

    // Mode Antigravity (nouveau paramètre non disponible dans l'ancien gemini-cli)
    argsSpawn.push('--mode', mode);

    // Prompt via fichier pour éviter les problèmes de quotes Windows
    const promptFile = path.join(agentAntigravityDir, '.prompt_temp.md');
    fs.writeFileSync(promptFile, finalPrompt, 'utf8');
    this.tempFiles.push(promptFile);
    argsSpawn.push('--prompt-file', promptFile);

    // Session si resume
    if (sessionId) {
      argsSpawn.push('--session', sessionId);
    } else if (autoResume) {
      argsSpawn.push('--session', 'latest');
    }

    // Config Antigravity
    argsSpawn.push('--antigravity-dir', agentAntigravityDir);
    argsSpawn.push('--output-format', 'json');
    argsSpawn.push('--approval-mode', 'yolo');

    if (agentName) {
      argsSpawn.push('--agent-name', agentName);
    }

    const runImpl = async (span: Span): Promise<RunAgentResult> => {
      span.setAttribute('agentName', agentName || '');
      span.setAttribute('runner', 'gemini'); // still "gemini" in telemetry for backwards compat
      span.setAttribute('mode', mode);

      return new Promise((resolve) => {
        let resolved = false;
        const safeResolve = (value: RunAgentResult) => {
          if (!resolved) {
            resolved = true;
            resolve(value);
          }
        };

        const child: ChildProcess = spawn(command, argsSpawn, {
          cwd: options.cwd || process.cwd(),
          shell: false,
          windowsHide: true,
          env: agentCustomEnv as NodeJS.ProcessEnv,
        });

        // Register process
        if (child.pid) {
          void registerProcess(child.pid, {
            agentName: agentName || '',
            runner: 'gemini',
            configPath: options.configPath,
          });
        }

        let stdout = '';
        let stderr = '';
        const MAX_BUF = 10 * 1024 * 1024;
        const cleanup = () => {
          child.stdout?.removeAllListeners();
          child.stderr?.removeAllListeners();
          child.removeAllListeners();
        };

        child.stdout?.on('data', (data) => {
          const d = data.toString();
          if (child.pid && d) {
            void appendOutput(child.pid, d, options.configPath);
          }
          if (stdout.length + d.length > MAX_BUF) stdout = stdout.slice(-MAX_BUF);
          else stdout += d;
        });

        child.stderr?.on('data', (data) => {
          const d = data.toString();
          if (child.pid && d) {
            void appendOutput(child.pid, d, options.configPath);
          }
          if (stderr.length + d.length > MAX_BUF) stderr = stderr.slice(-MAX_BUF);
          else stderr += d;
        });

        const timeout = setTimeout(async () => {
          if (child.pid) await killProcessTree(child.pid);
          else child.kill();
          await new Promise<void>((res) => setTimeout(res, 5000));
          if (!child.killed) {
            if (child.pid) await killProcessTree(child.pid);
            else child.kill('SIGKILL');
          }
          if (child.pid) {
            void updateProcessStatus(child.pid, 'failed', null, options.configPath);
          }
          cleanup();
          safeResolve({ result: '', error: 'TIMEOUT', rawOutput: stdout + stderr });
        }, this.timeoutMs);

        child.on('error', (err: Error) => {
          clearTimeout(timeout);
          safeResolve({ result: '', error: `SPAWN_ERROR: ${err.message}`, rawOutput: '' });
        });

        child.on('close', async (code: number | null) => {
          clearTimeout(timeout);
          cleanup();

          if (code !== 0 && !stdout) {
            return safeResolve({
              result: '',
              error: code === 41 ? '🔑 Erreur Auth/API Key (OAuth/GCloud)' : `EXIT_CODE_${code}`,
              rawOutput: stderr,
            });
          }

          try {
            // Try to parse JSON output (identique à avant)
            const trimmedStdout = stdout.trim();
            let jsonOutput: Record<string, unknown> | null = null;

            try {
              jsonOutput = JSON.parse(trimmedStdout);
            } catch {
              // Parser failure - try to extract JSON from output
              const lastBrace = trimmedStdout.lastIndexOf('}');
              const firstBrace = trimmedStdout.lastIndexOf('{', lastBrace);
              if (firstBrace !== -1 && lastBrace !== -1) {
                try {
                  jsonOutput = JSON.parse(trimmedStdout.substring(firstBrace, lastBrace + 1));
                } catch {
                  // Ignore parsing errors
                }
              }
            }

            if (jsonOutput) {
              const resultText =
                (jsonOutput.reply as string) ||
                (jsonOutput.result as string) ||
                (jsonOutput.output as string) ||
                stdout.trim();
              const newSessionId = (jsonOutput.session_id as string) || sessionId;

              if (newSessionId && agentName) {
                await saveSessionId(agentName, newSessionId, options.configPath, 'gemini');
                if (child.pid) {
                  void linkSessionToPid(newSessionId, child.pid, options.configPath);
                }
              }

              return safeResolve({
                result: resultText,
                sessionId: newSessionId,
                rawOutput: stdout,
              });
            }

            // No JSON - return raw output
            return safeResolve({
              result: stdout.trim(),
              sessionId: sessionId,
              rawOutput: stdout,
            });
          } catch {
            return safeResolve({
              result: stdout.trim(),
              sessionId: sessionId,
              rawOutput: stdout,
            });
          }
        });

        if (child.stdin) {
          child.stdin.end();
        }
      });
    };

    const result = await withSpan('gemini.runAgent', runImpl, {
      agentName: agentName || '',
      runner: 'gemini',
    });

    // Cleanup
    this.cleanupTempFiles();

    return result;
  }
}