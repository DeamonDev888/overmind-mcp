import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { CONFIG, resolveConfigPath } from '../lib/config.js';
import { getLastSessionId, saveSessionId } from '../lib/sessions.js';
import { interpolateEnvVars } from '../lib/envUtils.js';
import { resolveModel } from '../lib/modelMapping.js';

export interface RunAgentOptions {
  prompt: string;
  agentName?: string;
  sessionId?: string;
  autoResume?: boolean;
  model?: string;
  cwd?: string;
  configPath?: string;
  silent?: boolean;
}

export interface RunAgentResult {
  result: string;
  sessionId?: string;
  error?: string;
  rawOutput?: string;
  model?: string; // resolved real model ID (e.g. 'claude-opus-4-7')
  nickname?: string; // original value from config (e.g. 'The Data Alchemist')
  fallbackUsed?: string; // which fallback token was used (e.g. 'AUTH_FALLBACK_1')
}

export class ClaudeRunner {
  private config: typeof CONFIG.CLAUDE;
  private timeoutMs: number;

  constructor() {
    this.config = CONFIG.CLAUDE;
    this.timeoutMs = CONFIG.TIMEOUT_MS || 900000;
  }

  async runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
    const { prompt, agentName, autoResume } = options;
    let { sessionId } = options;
    const { CORE, PERMISSIONS, PATHS } = this.config;
    const agentCustomEnv: Record<string, string> = {};

    if (agentName) {
      agentCustomEnv.OVERMIND_AGENT_NAME = agentName;
    }

    // --- Auto Resume ---
    if (autoResume && agentName && !sessionId) {
      const lastId = await getLastSessionId(agentName, options.configPath, 'claude');
      if (lastId) {
        sessionId = lastId;
        if (!options.silent) {
          console.log(`[ClaudeRunner] Auto-resume session: ${sessionId}`);
        }
      }
    }

    let settingsPath = resolveConfigPath(PATHS.SETTINGS, options.configPath);

    if (agentName) {
      const settingsDir = path.dirname(PATHS.SETTINGS);
      const specificSettingsPath = resolveConfigPath(
        path.join(settingsDir, `settings_${agentName}.json`),
        options.configPath,
      );

      if (!fs.existsSync(specificSettingsPath)) {
        return {
          result: '',
          error: `INVALID_AGENT: Agent "${agentName}" non trouvé.`,
        };
      }
      settingsPath = specificSettingsPath;
    }

    let mcpPath = resolveConfigPath(PATHS.MCP, options.configPath);
    let tmpMcpPathToDelete: string | null = null;
    let tmpSettingsPathToDelete: string | null = null;
    let customTimeoutMs = this.timeoutMs;

    if (agentName) {
      try {
        const agentSettingsPath = resolveConfigPath(
          path.join(path.dirname(PATHS.SETTINGS), `settings_${agentName}.json`),
          options.configPath,
        );
        if (fs.existsSync(agentSettingsPath)) {
          let settings = JSON.parse(fs.readFileSync(agentSettingsPath, 'utf8'));

          // --- New interpolation logic ---
          settings = interpolateEnvVars(settings);

          // 1. Create a temporary settings file with interpolated values
          const tmpSettingsPath = path.join(
            path.dirname(agentSettingsPath),
            `settings_${agentName}_tmp.json`,
          );
          fs.writeFileSync(tmpSettingsPath, JSON.stringify(settings, null, 2));
          settingsPath = tmpSettingsPath;
          tmpSettingsPathToDelete = tmpSettingsPath;

          if (settings.env) {
            Object.assign(agentCustomEnv, settings.env);
            if (settings.env.AGENT_TIMEOUT_MS || settings.env.API_TIMEOUT_MS) {
              const timeoutValue = settings.env.AGENT_TIMEOUT_MS || settings.env.API_TIMEOUT_MS;
              customTimeoutMs = parseInt(timeoutValue, 10) || customTimeoutMs;
            }
            if (!options.model && settings.env.MODEL) {
              agentCustomEnv.ANTHROPIC_MODEL = settings.env.MODEL;
            }
          }

          const agentMcpPath = resolveConfigPath(
            path.join(path.dirname(PATHS.SETTINGS), `.mcp.${agentName}.json`),
          );

          if (fs.existsSync(agentMcpPath)) {
            mcpPath = agentMcpPath;
          } else if (
            settings.enableAllProjectMcpServers === false &&
            Array.isArray(settings.enabledMcpjsonServers)
          ) {
            if (fs.existsSync(mcpPath)) {
              const fullMcp = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
              const filteredMcp: { mcpServers: Record<string, unknown> } = { mcpServers: {} };

              for (const serverName of settings.enabledMcpjsonServers) {
                if (fullMcp.mcpServers && fullMcp.mcpServers[serverName]) {
                  filteredMcp.mcpServers[serverName] = fullMcp.mcpServers[serverName];
                }
              }

              const tmpMcpPath = path.join(
                path.dirname(agentSettingsPath),
                `mcp_${agentName}_tmp.json`,
              );
              fs.writeFileSync(tmpMcpPath, JSON.stringify(filteredMcp, null, 2));
              mcpPath = tmpMcpPath;
              tmpMcpPathToDelete = tmpMcpPath;
            }
          }
        }
      } catch (e) {
        console.error(`[ClaudeRunner] [WARN] Error processing agent settings: ${e}`);
      }
    }

    const argsSpawn: string[] = [];
    if (CORE) argsSpawn.push(...CORE.split(' ').filter(Boolean));
    if (PERMISSIONS) argsSpawn.push(...PERMISSIONS.split(' ').filter(Boolean));

    argsSpawn.push('--settings', settingsPath);
    argsSpawn.push('--mcp-config', mcpPath);
    argsSpawn.push('--output-format', 'json');

    let modelUsed = options.model;
    if (!modelUsed && agentCustomEnv.ANTHROPIC_MODEL) {
      modelUsed = agentCustomEnv.ANTHROPIC_MODEL;
    }

    // Remember original value (nickname or raw model) for display
    const originalModel = modelUsed ?? '';

    // Resolve nickname → real model ID before calling the API
    if (modelUsed) {
      modelUsed = resolveModel(modelUsed);
    }

    if (sessionId) argsSpawn.push('--resume', sessionId);

    if (modelUsed) argsSpawn.push('--model', modelUsed);
    if (agentName) argsSpawn.push('--name', agentName);

    // ───────────────────────────────────────────────────────────────────────────
    // 🔄 FALLBACK TOKEN RETRY LOGIC
    //
    // Overmind lit les tokens fallback depuis agentCustomEnv (résolus depuis $VAR).
    // Si une erreur 401 (auth) survient, on tente chaque fallback séquentiellement :
    //   AUTH_FALLBACK_1 → AUTH_FALLBACK_2 → AUTH_FALLBACK_3
    //
    // Settings exemple :
    //   { "env": { "ANTHROPIC_AUTH_TOKEN": "$ANTHROPIC_AUTH_FALLBACK_1" } }
    // ───────────────────────────────────────────────────────────────────────────
    const FALLBACK_KEYS = ['AUTH_FALLBACK_1', 'AUTH_FALLBACK_2', 'AUTH_FALLBACK_3'];
    const TOKEN_KEYS = ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_AUTH_TOKEN_E'];

    /**
     * Vérifie si le stderr contient une erreur d'authentification (401).
     * Claude CLI affiche des messages explicites en cas d'auth failure.
     */
    const isAuthError = (stderr: string): boolean => {
      const lower = stderr.toLowerCase();
      return (
        lower.includes('401') ||
        lower.includes('unauthorized') ||
        lower.includes('invalid api key') ||
        lower.includes('api key invalid') ||
        lower.includes('authentication failed') ||
        lower.includes('auth error') ||
        lower.includes('invalid authentication')
      );
    };

    /**
     * Extrait les tokens fallback disponibles depuis agentCustomEnv.
     * Retourne un tableau de { key, value } pour chaque fallback non vide.
     */
    const getAvailableFallbacks = (): Array<{ key: string; value: string }> => {
      const fallbacks: Array<{ key: string; value: string }> = [];
      for (const key of FALLBACK_KEYS) {
        const val = agentCustomEnv[key];
        if (val && typeof val === 'string' && val.length > 0 && !val.startsWith('$')) {
          fallbacks.push({ key, value: val });
        }
      }
      return fallbacks;
    };

    /**
     * Détermine quel token utiliser : le fallback à l'index donné,
     * ou le primary token ANTHROPIC_AUTH_TOKEN / ANTHROPIC_AUTH_TOKEN_E.
     */
    const getTokenForIndex = (index: number): { tokenEnvKey: string; tokenValue: string } | null => {
      // Essayer d'abord le primary token
      for (const tk of TOKEN_KEYS) {
        const val = agentCustomEnv[tk];
        if (val && typeof val === 'string' && val.length > 0 && !val.startsWith('$')) {
          return { tokenEnvKey: tk, tokenValue: val };
        }
      }
      // Puis les fallbacks
      const fallbacks = getAvailableFallbacks();
      if (index < fallbacks.length) {
        return { tokenEnvKey: fallbacks[index].key, tokenValue: fallbacks[index].value };
      }
      return null;
    };

    return new Promise((resolve) => {
      let resolved = false;
      let retryCount = 0;
      const maxRetries = getAvailableFallbacks().length + 1; // primary + fallbacks
      let currentChild: ChildProcess | null = null;
      let currentStderr = '';
      let currentStdout = '';
      let currentSessionId: string | undefined = sessionId;

      const safeResolve = (value: RunAgentResult) => {
        if (!resolved) {
          resolved = true;
          resolve(value);
        }
      };

      const cleanupTmpFiles = () => {
        if (tmpMcpPathToDelete && fs.existsSync(tmpMcpPathToDelete)) {
          try {
            fs.unlinkSync(tmpMcpPathToDelete);
          } catch {
            // Ignored
          }
        }
        if (tmpSettingsPathToDelete && fs.existsSync(tmpSettingsPathToDelete)) {
          try {
            fs.unlinkSync(tmpSettingsPathToDelete);
          } catch {
            // Ignored
          }
        }
      };

      let killTimer: NodeJS.Timeout | null = null;
      let hardTimeoutTimer: NodeJS.Timeout | null = null;

      /**
       * Fonction centrale qui spawn le processus Claude avec le bon token.
       * Appelé initialement et après chaque retry.
       */
      const spawnWithToken = (tokenInfo: { tokenEnvKey: string; tokenValue: string } | null) => {
        // Nettoyer les listeners/timers de la tentative précédente
        if (hardTimeoutTimer) { clearTimeout(hardTimeoutTimer); hardTimeoutTimer = null; }
        if (killTimer) { clearTimeout(killTimer); killTimer = null; }

        // Construire l'env avec le bon token
        // NOTE: Overmind gère la substitution des variables $VAR dans les settings.
        // Les fallback tokens (AUTH_FALLBACK_1/2/3) sont résolus ici pour le retry 401.
        const spawnEnv: Record<string, string> = {
          ...(process.env as Record<string, string>),
          ...agentCustomEnv,
        };
        if (tokenInfo) {
          // Remplacer le token actif par celui du fallback
          for (const tk of TOKEN_KEYS) {
            delete spawnEnv[tk];
          }
          spawnEnv[tokenInfo.tokenEnvKey] = tokenInfo.tokenValue;
        }

        currentStderr = '';
        currentStdout = '';

        let command = 'claude';
        let spawnArgs: string[] = [];

        if (process.platform === 'win32') {
          command = 'cmd.exe';
          spawnArgs = ['/c', 'claude', ...argsSpawn, '-p'];
        } else {
          spawnArgs = [...argsSpawn, '-p'];
        }

        if (!options.silent) {
          const tokenLabel = tokenInfo ? ` (token: ${tokenInfo.tokenEnvKey})` : '';
          process.stderr.write(
            `\n\x1b[33m[ClaudeRunner]${tokenLabel} Spawning Claude CLI...\x1b[0m\n`,
          );
        }

        currentChild = spawn(command, spawnArgs, {
          cwd: options.cwd || process.cwd(),
          windowsHide: true,
          env: spawnEnv,
          shell: false,
        });

        if (currentChild.stdout) {
          currentChild.stdout.on('data', (d: Buffer) => {
            const chunk = d.toString();
            currentStdout += chunk;
            if (agentName && !options.silent) {
              process.stderr.write(`[ClaudeRunner:${agentName}] ${chunk}`);
            }
          });
        }

        if (currentChild.stderr) {
          currentChild.stderr.on('data', (d: Buffer) => {
            const chunk = d.toString();
            currentStderr += chunk;
            if (agentName && !options.silent) {
              process.stderr.write(`[ClaudeRunner:${agentName}:ERR] ${chunk}`);
            }
          });
        }

        if (currentChild.stdin) {
          currentChild.stdin.write(prompt);
          currentChild.stdin.end();
        }

        const timeout = setTimeout(() => {
          if (currentChild && currentChild.stdin && !currentChild.stdin.destroyed) {
            try {
              currentChild.stdin.write('\n');
              if (!options.silent) {
                process.stderr.write(
                  `\n\x1b[33m[ClaudeRunner] [WARN] Agent stagnant (${customTimeoutMs}ms). Envoi d'un keep-alive (\\n)...\x1b[0m\n`,
                );
              }
            } catch (_e) {
              // Ignore
            }
          }

          const hardTimeoutDelay = CONFIG.HARD_TIMEOUT_MS || 60000;
          hardTimeoutTimer = setTimeout(() => {
            if (currentChild) currentChild.kill();
            killTimer = setTimeout(() => {
              if (currentChild && !currentChild.killed) currentChild.kill('SIGKILL');
            }, 5000);
            cleanupTmpFiles();
            safeResolve({ result: '', error: 'HARD_TIMEOUT', rawOutput: currentStdout + currentStderr });
          }, hardTimeoutDelay);
        }, customTimeoutMs);

        currentChild.on('error', (err: Error) => {
          clearTimeout(timeout);
          if (hardTimeoutTimer) clearTimeout(hardTimeoutTimer);
          cleanupTmpFiles();
          safeResolve({ result: '', error: `SPAWN_ERROR: ${err.message}`, rawOutput: '' });
        });

        currentChild.on('close', async (code: number | null) => {
          clearTimeout(timeout);
          if (hardTimeoutTimer) clearTimeout(hardTimeoutTimer);

          const fullRaw = currentStdout + (currentStderr ? `\n\n--- STDERR ---\n${currentStderr}` : '');

          // ─── Parser le JSON en premier (pour extraire api_error_status) ───
          let jsonEnvelope: Record<string, unknown> | null = null;
          const trimmedStdout = currentStdout.trim();

          try {
            jsonEnvelope = JSON.parse(trimmedStdout);
          } catch {
            const lastBrace = trimmedStdout.lastIndexOf('}');
            const firstBrace = trimmedStdout.lastIndexOf('{', lastBrace);
            if (firstBrace !== -1 && lastBrace !== -1) {
              try {
                jsonEnvelope = JSON.parse(trimmedStdout.substring(firstBrace, lastBrace + 1));
              } catch {
                // Ignored
              }
            }
          }

          // ─── Vérification 401 / Auth Error → Retry avec fallback ───
          // Le 401 peut apparaître dans stderr OU dans le JSON résultat (api_error_status: 401)
          const has401InStderr = isAuthError(currentStderr);
          const has401InResult =
            jsonEnvelope !== null &&
            ((jsonEnvelope.api_error_status === 401) ||
              (typeof jsonEnvelope.result === 'string' && isAuthError(jsonEnvelope.result)));
          const isAuthFailure = (code !== 0 && has401InStderr) || has401InResult;

          if (isAuthFailure) {
            const tokenInfo = getTokenForIndex(retryCount);
            if (tokenInfo && retryCount < maxRetries) {
              retryCount++;
              if (!options.silent) {
                process.stderr.write(
                  `\n\x1b[41m\x1b[37m[ClaudeRunner] 🔄 Auth error (401). Retry ${retryCount}/${maxRetries} avec ${tokenInfo.tokenEnvKey}...\x1b[0m\n`,
                );
              }
              // Relancer avec le fallback suivant
              spawnWithToken(tokenInfo);
              return;
            } else {
              if (!options.silent) {
                process.stderr.write(
                  `\n\x1b[41m\x1b[37m[ClaudeRunner] ❌ Tous les tokens fallback épuisés. Auth error finale.\x1b[0m\n`,
                );
              }
              cleanupTmpFiles();
              safeResolve({
                result: '',
                error: 'AUTH_ERROR_ALL_FALLBACKS_EXHAUSTED',
                rawOutput: fullRaw,
              });
              return;
            }
          }

          cleanupTmpFiles();

          try {
            if (jsonEnvelope) {
              let foundSessionId = currentSessionId;
              if (jsonEnvelope.session_id && agentName) {
                foundSessionId = jsonEnvelope.session_id as string;
                currentSessionId = foundSessionId;
                await saveSessionId(
                  agentName,
                  jsonEnvelope.session_id as string,
                  options.configPath,
                  'claude',
                );
              }

              return safeResolve({
                result:
                  (jsonEnvelope.reply as string) ||
                  (jsonEnvelope.result as string) ||
                  currentStdout.trim(),
                sessionId: foundSessionId,
                rawOutput: currentStdout,
                model: modelUsed ?? undefined,
                nickname: originalModel !== modelUsed ? originalModel : undefined,
              });
            }

            if (code === 0) {
              return safeResolve({
                result: currentStdout.trim(),
                sessionId: currentSessionId,
                rawOutput: currentStdout,
                model: modelUsed ?? undefined,
                nickname: originalModel !== modelUsed ? originalModel : undefined,
              });
            }

            safeResolve({
              result: '',
              error: code !== 0 ? `EXIT_CODE_${code}` : 'JSON_PARSE_ERROR',
              rawOutput: fullRaw,
            });
          } catch (error) {
            safeResolve({
              result: '',
              error: `INTERNAL_ERROR: ${error instanceof Error ? error.message : String(error)}`,
              rawOutput: fullRaw,
            });
          }
        });
      };

      // ─── Démarrage initial avec le primary token ───
      spawnWithToken(getTokenForIndex(0));
    });
  }
}
