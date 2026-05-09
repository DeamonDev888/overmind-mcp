import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { CONFIG, resolveConfigPath } from '../lib/config.js';
import { getLastSessionId, saveSessionId } from '../lib/sessions.js';
import { interpolateEnvVars } from '../lib/envUtils.js';
import { resolveModel } from '../lib/modelMapping.js';
import { withSpan } from '../lib/telemetry.js';
import { Span } from '@opentelemetry/api';

export interface RunAgentOptions {
  prompt: string;
  agentName?: string;
  sessionId?: string;
  autoResume?: boolean;
  model?: string;
  cwd?: string;
  configPath?: string;
  silent?: boolean;
  signal?: AbortSignal;
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
     * Vérifie si une erreur est retryable (fallback recommended).
     * 401 = auth error (token invalide/expiré)
     * 429 = rate limit / quota exhausted
     * 500/502/503 = server error
     */
    const isRetryableError = (stderr: string, jsonEnv: Record<string, unknown> | null): boolean => {
      const lower = stderr.toLowerCase();
      const status = jsonEnv?.api_error_status as number | undefined;

      if (status === 401) return true;
      if (status === 429) return true;
      if (status === 500 || status === 502 || status === 503) return true;

      return (
        lower.includes('401') ||
        lower.includes('unauthorized') ||
        lower.includes('invalid api key') ||
        lower.includes('api key invalid') ||
        lower.includes('authentication failed') ||
        lower.includes('auth error') ||
        lower.includes('invalid authentication') ||
        lower.includes('429') ||
        lower.includes('rate limit') ||
        lower.includes('quota exhausted') ||
        lower.includes('limit exhausted') ||
        lower.includes('503') ||
        lower.includes('service unavailable') ||
        lower.includes('500') ||
        lower.includes('internal server error')
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
        if (val && typeof val === 'string' && val.length > 0) {
          fallbacks.push({ key, value: val });
        }
      }
      return fallbacks;
    };

    /**
     * Détermine quel token utiliser selon l'index de retry.
     * - index 0 = tentative initiale → use primary token (ANTHROPIC_AUTH_TOKEN)
     * - index 1+ = retry → skip primary, use fallbacks directly
     */
    const getTokenForIndex = (
      index: number,
    ): { tokenEnvKey: string; tokenValue: string } | null => {
      if (index === 0) {
        // Tentative initiale : utiliser le primary token
        // NOTE: si la valeur est un $VAR non résolu (interpolateEnvVars n'a pas trouvé
        // la variable dans process.env à ce moment), on le passe quand même à spawnWithToken
        // qui fera la résolution finale via process.env.
        for (const tk of TOKEN_KEYS) {
          const val = agentCustomEnv[tk];
          if (val && typeof val === 'string' && val.length > 0) {
            return { tokenEnvKey: tk, tokenValue: val };
          }
        }
        // Aucun primary token trouvé — retourner null plutôt que de tomber dans les fallbacks
        return null;
      }
      // Retry (index >= 1) : skip primary, use fallbacks directly
      const fallbacks = getAvailableFallbacks();
      const fallbackIndex = index - 1; // index 1 → fallback[0] (AUTH_FALLBACK_1)
      if (fallbackIndex < fallbacks.length) {
        return { tokenEnvKey: fallbacks[fallbackIndex].key, tokenValue: fallbacks[fallbackIndex].value };
      }
      return null;
    };

    // ─── AbortSignal support ─────────────────────────────────────────────────────
    let currentChildRef: ChildProcess | null = null;
    if (options.signal?.aborted) {
      return Promise.reject(new Error('ABORTED'));
    }
    options.signal?.addEventListener('abort', () => {
      if (currentChildRef) currentChildRef.kill('SIGTERM');
    });

    const runImpl = async (span: Span): Promise<RunAgentResult> => {
      span.setAttribute('agentName', agentName || '');
      span.setAttribute('model', modelUsed || '');
      span.setAttribute('runner', 'claude');

      return new Promise((resolve) => {
        let resolved = false;
        let retryCount = 0;
        const maxRetries = getAvailableFallbacks().length + 1; // primary + fallbacks
        currentChildRef = null;
        let currentStderr = '';
        let currentStdout = '';
        const MAX_BUF = 10 * 1024 * 1024;
        let currentSessionId: string | undefined = sessionId;
        let earlyExitTriggered = false; // Prevent double-exit on early retry

        const safeResolve = (value: RunAgentResult) => {
          if (!resolved) {
            resolved = true;
            resolve(value);
          }
        };

        const triggerRetry = (targetRetryCount: number) => {
          if (earlyExitTriggered) return;
          earlyExitTriggered = true;
          if (currentChildRef && !currentChildRef.killed) {
            currentChildRef.kill();
          }
          if (hardTimeoutTimer) clearTimeout(hardTimeoutTimer);
          if (killTimer) clearTimeout(killTimer);
          if (timeout) clearTimeout(timeout);
          retryCount = targetRetryCount;
          const tokenInfo = getTokenForIndex(retryCount);
          if (!options.silent) {
            process.stderr.write(
              `\n\x1b[41m\x1b[37m[ClaudeRunner] 🔄 Retry ${retryCount}/${maxRetries} avec ${tokenInfo?.tokenEnvKey || 'UNKNOWN'}...\x1b[0m\n`,
            );
          }
          setImmediate(() => spawnWithToken(tokenInfo));
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
        const timeout: NodeJS.Timeout | null = null;

        /**
         * Fonction centrale qui spawn le processus Claude avec le bon token.
         * Appelé initialement et après chaque retry.
         */
        const spawnWithToken = (tokenInfo: { tokenEnvKey: string; tokenValue: string } | null) => {
          // Nettoyer les listeners/timers de la tentative précédente
          if (hardTimeoutTimer) {
            clearTimeout(hardTimeoutTimer);
            hardTimeoutTimer = null;
          }
          if (killTimer) {
            clearTimeout(killTimer);
            killTimer = null;
          }

          // Construire l'env avec le bon token
          // NOTE: Overmind gère la substitution des variables $VAR dans les settings.
          // Les fallback tokens (AUTH_FALLBACK_1/2/3) sont résolus ici pour le retry 401.
          const spawnEnv: Record<string, string> = {
            ...(process.env as Record<string, string>),
            ...agentCustomEnv,
          };
          if (tokenInfo) {
            // Remplacer le token actif par celui du fallback
            // NOTE: Les tokens peuvent encore contenir des $VAR non résolus
            // (interpolateEnvVars n'a pas trouvé ces vars dans process.env au moment du load).
            // On résout ici via process.env (qui a été peuplé par loadEnvQuietly).
            for (const tk of TOKEN_KEYS) {
              delete spawnEnv[tk];
            }
            let resolvedToken = tokenInfo.tokenValue;
            if (resolvedToken.startsWith('$')) {
              const envKey = resolvedToken.slice(1);
              resolvedToken = process.env[envKey] || resolvedToken;
            }
            // Le Claude CLI lit ANTHROPIC_AUTH_TOKEN — on injecte toujours sous ce nom,
            // peu importe que tokenInfo vienne du primary ou d'un AUTH_FALLBACK_n.
            spawnEnv['ANTHROPIC_AUTH_TOKEN'] = resolvedToken;
          }

          currentStderr = '';
          currentStdout = '';

          let command = 'claude';
          let spawnArgs: string[] = [];

          // Sur retry avec un token fallback, on doit démarrer une nouvelle session.
          // Reprendre (--resume) une session créée par un autre compte/token fait que
          // le provider (ex: Z.AI) lie la session au compte original → le quota du
          // compte original s'applique même avec un nouveau token → 429 parasite.
          const isFallbackRetry =
            tokenInfo !== null && tokenInfo.tokenEnvKey.startsWith('AUTH_FALLBACK_');
          let effectiveArgs = argsSpawn;
          if (isFallbackRetry) {
            effectiveArgs = [];
            for (let i = 0; i < argsSpawn.length; i++) {
              if (argsSpawn[i] === '--resume') {
                i++; // skip the value too
                continue;
              }
              effectiveArgs.push(argsSpawn[i]);
            }
          }

          if (process.platform === 'win32') {
            command = 'cmd.exe';
            spawnArgs = ['/c', 'claude', ...effectiveArgs, '-p'];
          } else {
            spawnArgs = [...effectiveArgs, '-p'];
          }

          if (!options.silent) {
            const tokenLabel = tokenInfo ? ` (token: ${tokenInfo.tokenEnvKey})` : '';
            process.stderr.write(
              `\n\x1b[33m[ClaudeRunner]${tokenLabel} Spawning Claude CLI...\x1b[0m\n`,
            );
          }

          currentChildRef = spawn(command, spawnArgs, {
            cwd: options.cwd || process.cwd(),
            windowsHide: true,
            env: spawnEnv,
            shell: false,
            signal: options.signal,
          });

          if (currentChildRef.stdout) {
            currentChildRef.stdout.on('data', (d: Buffer) => {
              const chunk = d.toString();
              if (currentStdout.length + chunk.length > MAX_BUF)
                currentStdout = currentStdout.slice(-MAX_BUF);
              else currentStdout += chunk;
              if (agentName && !options.silent) {
                process.stderr.write(`[ClaudeRunner:${agentName}] ${chunk}`);
              }
            });
          }

          if (currentChildRef.stderr) {
            currentChildRef.stderr.on('data', (d: Buffer) => {
              const chunk = d.toString();
              if (currentStderr.length + chunk.length > MAX_BUF)
                currentStderr = currentStderr.slice(-MAX_BUF);
              else currentStderr += chunk;
              if (agentName && !options.silent) {
                process.stderr.write(`[ClaudeRunner:${agentName}:ERR] ${chunk}`);
              }
            });
          }

          if (currentChildRef.stdin) {
            currentChildRef.stdin.write(prompt);
            currentChildRef.stdin.end();
          }

          const timeout = setTimeout(() => {
            if (currentChildRef && currentChildRef.stdin && !currentChildRef.stdin.destroyed) {
              try {
                currentChildRef.stdin.write('\n');
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
              if (currentChildRef) currentChildRef.kill();
              killTimer = setTimeout(() => {
                if (currentChildRef && !currentChildRef.killed) currentChildRef.kill('SIGKILL');
              }, 5000);
              cleanupTmpFiles();
              safeResolve({
                result: '',
                error: 'HARD_TIMEOUT',
                rawOutput: currentStdout + currentStderr,
              });
            }, hardTimeoutDelay);
          }, customTimeoutMs);

          currentChildRef.on('error', (err: Error) => {
            clearTimeout(timeout);
            if (hardTimeoutTimer) clearTimeout(hardTimeoutTimer);
            cleanupTmpFiles();
            safeResolve({ result: '', error: `SPAWN_ERROR: ${err.message}`, rawOutput: '' });
          });

          currentChildRef.on('close', async (code: number | null) => {
            clearTimeout(timeout);
            if (hardTimeoutTimer) clearTimeout(hardTimeoutTimer);

            const fullRaw =
              currentStdout + (currentStderr ? `\n\n--- STDERR ---\n${currentStderr}` : '');

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

            // ─── Fallback retry — DÉSACTIVÉ (en standby) ───────────────────────
            // Le retry interne au runner ne peut pas changer effectivement de token :
            // Claude CLI réutilise l'auth de la session (--resume / session-env) ou
            // d'autres credentials hérités, donc le fallback se retrouve à soumettre
            // la même clé que l'attempt précédent. Conséquence observée : 429 répété
            // avec exactement le même message (Anthropic Console quota), même quand
            // la clé fallback fonctionne en direct (curl OK, primary OK).
            //
            // TODO(bridge/client) : réimplémenter le fallback en amont du runner —
            // côté bridge HTTP (overmind-bridge.js / nexus-api-server) ou côté
            // client Discord. Au lieu de relancer un subprocess `claude` qui hérite
            // de l'état session, le bridge doit :
            //   1. détecter la 429/401 dans la réponse JSON du runner
            //   2. relancer un nouveau call run_agent avec un agent/settings dont
            //      le ANTHROPIC_AUTH_TOKEN primary pointe sur la clé suivante
            //      (ou cloner l'agent à la volée avec settings overridés)
            //   3. ne PAS passer de sessionId pour cette nouvelle tentative
            // ───────────────────────────────────────────────────────────────────
            const FALLBACK_RETRY_ENABLED = false;
            const isRetryable = isRetryableError(currentStderr, jsonEnvelope);
            const hasRetryableStatus =
              jsonEnvelope !== null &&
              (jsonEnvelope.api_error_status === 401 ||
                jsonEnvelope.api_error_status === 429 ||
                jsonEnvelope.api_error_status === 500 ||
                jsonEnvelope.api_error_status === 502 ||
                jsonEnvelope.api_error_status === 503);
            const isFailure =
              FALLBACK_RETRY_ENABLED && ((code !== 0 && isRetryable) || hasRetryableStatus);

            if (isFailure) {
              if (retryCount < maxRetries) {
                triggerRetry(retryCount + 1);
                return;
              } else {
                if (!options.silent) {
                  process.stderr.write(
                    `\n\x1b[41m\x1b[37m[ClaudeRunner] ❌ Tous les tokens fallback épuisés. Error retryable finale.\x1b[0m\n`,
                  );
                }
                cleanupTmpFiles();
                safeResolve({
                  result: '',
                  error: 'RETRYABLE_ERROR_ALL_FALLBACKS_EXHAUSTED',
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
    };

    return withSpan('claude.runAgent', runImpl, {
      agentName: agentName || '',
      model: modelUsed || '',
      runner: 'claude',
    });
  }
}
