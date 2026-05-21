import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { CONFIG, resolveConfigPath } from '../lib/config.js';
import { getLastSessionId, saveSessionId } from '../lib/sessions.js';
import { interpolateEnvVars } from '../lib/envUtils.js';
import { PromptManager } from './PromptManager.js';
import { resolveKiloModel } from '../lib/modelMapping.js';
import { withSpan, type Span } from '../lib/telemetry.js';
import { loadEnvQuietly } from '../lib/loadEnv.js';
import {
  registerProcess,
  linkSessionToPid,
  appendOutput,
  updateProcessStatus,
  killProcessTree,
} from '../lib/processRegistry.js';

export interface RunAgentOptions {
  prompt: string;
  agentName?: string;
  sessionId?: string;
  autoResume?: boolean;
  mode?: 'code' | 'architect' | 'ask' | 'debug' | 'orchestrator';
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
  model?: string; // resolved real model ID (e.g. 'minimax/MiniMax-Text-01')
  nickname?: string; // original value from config (e.g. 'mini-max-m2.7-highspeed')
  fallbackUsed?: string; // which fallback token was used (e.g. 'AUTH_FALLBACK_1')
}


export class KiloRunner {
  private config: typeof CONFIG.KILO;
  private timeoutMs: number;

  /* eslint-disable no-useless-escape */
  static INSTALL_INSTRUCTIONS = `
💡 **Comment installer/mettre à jour Kilo Code v7.2.14 :**

**Option A — VS Code (Recommandé)**
1. Dans VS Code, Extensions (Ctrl+Shift+X)
2. Recherchez "Kilo Code" par "kilocode"
3. Ou via terminal : \`code --install-extension kilocode.Kilo-Code\`

**Option B — CLI Standalone (Binaire)**
1. Téléchargez \`kilo-windows-x64.zip\` depuis : https://github.com/Kilo-Org/kilocode/releases
2. Extrayez \`kilo.exe\` et placez-le dans un dossier de votre PATH (ex: \`%USERPROFILE%\AppData\Roaming\npm\`)

**Option C — Scoop**
\`scoop bucket add kilo https://github.com/Kilo-Org/scoop-kilo\`
\`scoop install kilo\`
`;

  constructor() {
    this.config = CONFIG.KILO;
    this.timeoutMs = CONFIG.TIMEOUT_MS || 900000; // 15 minutes par défaut
  }

  async verifyInstallation(): Promise<{ ok: boolean; message?: string }> {
    const { verifyInstallation: check } = await import('../lib/InstallHelper.js');
    return check('kilo');
  }

  async runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
    // Load .env files first (before anything else) — same as ClaudeRunner/Hermes
    const cwd = options.cwd || process.cwd();
    loadEnvQuietly(path.join(cwd, '.env'));
    loadEnvQuietly(path.join(cwd, '../Workflow/.env'));

    const { prompt, agentName, autoResume, mode } = options;
    const startTime = Date.now();
    let { sessionId } = options;
    const { model } = options;
    const { PATHS, DEFAULT_MODEL } = this.config;
    const agentCustomEnv: Record<string, string> = {};

    // --- Auto Resume ---
    if (autoResume && agentName && !sessionId) {
      const lastId = await getLastSessionId(agentName, options.configPath, 'kilo');
      if (lastId) {
        sessionId = lastId;
        if (!options.silent) {
          process.stderr.write(
            `\x1b[33m[Kilo] [SESSION] Auto-resume session: ${sessionId}\x1b[0m\n`,
          );
        }
      }
    }

    let customTimeoutMs = this.timeoutMs;
    let selectedModel = model || DEFAULT_MODEL;
    const originalModel = selectedModel;

    // --- Isolation ---
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

          if (settings.env) {
            Object.assign(agentCustomEnv, settings.env);
            // Kilo uses OPENAI_API_BASE, not the Anthropic SDK.
            // Remove ANTHROPIC_BASE_URL so polyglot agents (Claude + Kilo)
            // don't accidentally redirect Kilo to a Claude-provider endpoint.
            delete agentCustomEnv['ANTHROPIC_BASE_URL']; // Allow custom base URL for Anthropic-compatible providers like Minimax
            if (settings.env.AGENT_TIMEOUT_MS || settings.env.API_TIMEOUT_MS) {
              customTimeoutMs =
                parseInt(settings.env.AGENT_TIMEOUT_MS || settings.env.API_TIMEOUT_MS, 10) ||
                customTimeoutMs;
            }
            if (!model && settings.model) {
              selectedModel = settings.model;
              if (!options.silent) {
                process.stderr.write(
                  `\x1b[35m[Kilo:Debug] model from settings: ${selectedModel}\x1b[0m\n`,
                );
              }
            } else if (!model && settings.env.MODEL) {
              selectedModel = settings.env.MODEL;
              if (!options.silent) {
                process.stderr.write(
                  `\x1b[35m[Kilo:Debug] MODEL from env: ${selectedModel}\x1b[0m\n`,
                );
              }
            } else if (!model && settings.env.KILO_MODEL) {
              selectedModel = settings.env.KILO_MODEL;
              if (!options.silent) {
                process.stderr.write(
                  `\x1b[35m[Kilo:Debug] KILO_MODEL from env: ${selectedModel}\x1b[0m\n`,
                );
              }
            } else if (!model && settings.env.ANTHROPIC_MODEL) {
              selectedModel = settings.env.ANTHROPIC_MODEL;
              if (!options.silent) {
                process.stderr.write(
                  `\x1b[35m[Kilo:Debug] ANTHROPIC_MODEL from env: ${selectedModel}\x1b[0m\n`,
                );
              }
            }
            if (!options.silent) {
              process.stderr.write(
                `\x1b[35m[Kilo:Debug] Final selectedModel (pre-mapping): ${selectedModel} (model arg was: ${model})\x1b[0m\n`,
              );
            }
          }
        }
      } catch (_e) {
        if (!options.silent) {
          process.stderr.write(`\x1b[31m[Kilo:Debug] Error loading agent settings: ${_e}\x1b[0m\n`);
        }
      }
    }

    // Apply mapping using shared resolver
    selectedModel = resolveKiloModel(selectedModel);

    // Build kilo args: kilo run [prompt] [options]
    const argsSpawn: string[] = ['run'];

    let effectivePrompt = prompt;
    if (agentName) {
      try {
        const promptManager = new PromptManager(options.configPath);
        const persona = await promptManager.getPromptContent(agentName);
        if (persona) {
          effectivePrompt = `${persona}\n\n---\n\n${prompt}`;
        }
      } catch (_e) {
        // Persona injection is best-effort
      }
    }

    argsSpawn.push(effectivePrompt);

    if (mode) {
      argsSpawn.push('--agent', mode);
    }

    if (sessionId && sessionId.length > 0) {
      argsSpawn.push('--session', sessionId);
    }
    if (selectedModel) argsSpawn.push('--model', selectedModel);

    // Required for non-interactive execution
    argsSpawn.push('--auto');
    argsSpawn.push('--format', 'json');

    if (cwd) {
      argsSpawn.push('--dir', cwd);
    }

    // ───────────────────────────────────────────────────────────────────────────
    // 🔄 FALLBACK TOKEN RETRY LOGIC
    //
    // Overmind lit les tokens fallback depuis agentCustomEnv (résolus depuis $VAR).
    // Si une erreur 401 (auth) survient, on tente chaque fallback séquentiellement :
    //   AUTH_FALLBACK_1 → AUTH_FALLBACK_2 → AUTH_FALLBACK_3
    //
    // Settings exemple :
    //   { "env": { "OPENAI_API_KEY": "$ANTHROPIC_AUTH_FALLBACK_1" } }
    // ───────────────────────────────────────────────────────────────────────────
    const FALLBACK_KEYS = ['AUTH_FALLBACK_1', 'AUTH_FALLBACK_2', 'AUTH_FALLBACK_3'];

    /**
     * Vérifie si le stderr contient une erreur d'authentification (401).
     * Kilo CLI affiche des messages explicites en cas d'auth failure.
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
        lower.includes('invalid authentication') ||
        lower.includes('openai authenticationerror') ||
        lower.includes('authenticationerror')
      );
    };

    /**
     * Extrait les tokens fallback disponibles depuis agentCustomEnv.
     */
    const getAvailableFallbacks = (): Array<{ key: string; value: string }> => {
      const fallbacks: Array<{ key: string; value: string }> = [];
      for (const key of FALLBACK_KEYS) {
        const val = agentCustomEnv[key];
        if (val && typeof val === 'string' && val.length > 0) {
          // Resolve $VAR like ClaudeRunner does
          let resolvedValue = val;
          if (val.startsWith('$')) {
            const envKey = val.slice(1);
            resolvedValue = process.env[envKey] || val;
          }
          fallbacks.push({ key, value: resolvedValue });
        }
      }
      return fallbacks;
    };

    /**
     * Détermine quel token API utiliser (pour Kilo = OPENAI_API_KEY).
     * Retourne le token du fallback à l'index donné.
     */
    const getTokenForIndex = (
      index: number,
    ): { tokenEnvKey: string; tokenValue: string } | null => {
      if (index === 0) {
        // Tentative initiale : utiliser le primary token
        const primaryKeys = ['OPENAI_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_AUTH_TOKEN_E'];
        for (const tk of primaryKeys) {
          const val = agentCustomEnv[tk];
          if (val && typeof val === 'string' && val.length > 0) {
            // Resolve $VAR if present
            let resolvedValue = val;
            if (val.startsWith('$')) {
              const envKey = val.slice(1);
              resolvedValue = process.env[envKey] || val;
            }
            return { tokenEnvKey: tk, tokenValue: resolvedValue };
          }
        }
        return null;
      }
      // Retry (index >= 1) : use fallbacks directly
      const fallbacks = getAvailableFallbacks();
      const fallbackIndex = index - 1;
      if (fallbackIndex < fallbacks.length) {
        return { tokenEnvKey: fallbacks[fallbackIndex].key, tokenValue: fallbacks[fallbackIndex].value };
      }
      return null;
    };

    const runImpl = async (span: Span): Promise<RunAgentResult> => {
      span.setAttribute('agentName', agentName || '');
      span.setAttribute('model', selectedModel || '');
      span.setAttribute('runner', 'kilo');

      return new Promise((resolve) => {
        let resolved = false;
        let retryCount = 0;
        const maxRetries = getAvailableFallbacks().length + 1;
        let currentChild: ChildProcess | null = null;
        let currentStdout = '';
        let currentStderr = '';
        const MAX_BUF = 10 * 1024 * 1024;
        let finalResult = '';
        let lastSessionId = sessionId;

        const safeResolve = (value: RunAgentResult) => {
          if (!resolved) {
            resolved = true;
            resolve(value);
          }
        };

        let killTimer: NodeJS.Timeout | null = null;
        let hardTimeoutTimer: NodeJS.Timeout | null = null;

        /**
         * Fonction centrale qui spawn Kilo avec le bon token.
         */
        const spawnWithToken = (tokenInfo: { tokenEnvKey: string; tokenValue: string } | null) => {
          if (hardTimeoutTimer) {
            clearTimeout(hardTimeoutTimer);
            hardTimeoutTimer = null;
          }
          if (killTimer) {
            clearTimeout(killTimer);
            killTimer = null;
          }

          // Construire l'env avec le bon token API
          // NOTE: Overmind gère la substitution des variables $VAR dans les settings.
          const spawnEnv: Record<string, string> = {
            ...(process.env as Record<string, string>),
            ...agentCustomEnv,
          };
          if (tokenInfo) {
            // Remplacer le token API actif par le fallback
            const apiKeys = ['OPENAI_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_AUTH_TOKEN_E'];
            for (const tk of apiKeys) {
              delete spawnEnv[tk];
            }
            spawnEnv[tokenInfo.tokenEnvKey] = tokenInfo.tokenValue;
          }

          currentStdout = '';
          currentStderr = '';
          finalResult = '';

          const command = 'kilo';

          if (!options.silent) {
            const tokenLabel = tokenInfo ? ` (token: ${tokenInfo.tokenEnvKey})` : '';
            process.stderr.write(
              `\n\x1b[33m[Kilo]${tokenLabel} ⚡ Initialisation de l'agent: ${agentName || 'Anonyme'}\x1b[0m\n`,
            );
            process.stderr.write(`\x1b[33m[Kilo] 🤖 Modèle: ${selectedModel}\x1b[0m\n`);
            if (mode) process.stderr.write(`\x1b[33m[Kilo] 🛠️ Mode/Agent: ${mode}\x1b[0m\n`);
            if (sessionId && sessionId.length > 0)
              process.stderr.write(`\x1b[33m[Kilo] 📜 Session: ${sessionId}\x1b[0m\n`);
            // Sanitize command args before display to prevent injection
            const sanitizedArgs = argsSpawn.map(arg => {
              let result = '';
              for (const char of arg) {
                const code = char.charCodeAt(0);
                // Skip control chars (0x00-0x1F) and DEL (0x7F)
                if (code >= 0x20 && code !== 0x7F) {
                  result += char;
                }
              }
              return result;
            }).join(' ');
            process.stderr.write(
              `\x1b[33m[Kilo] 🚀 Commande: ${command} ${sanitizedArgs}\x1b[0m\n`,
            );
          }

          currentChild = spawn(command, argsSpawn, {
            cwd: options.cwd || process.cwd(),
            shell: false,
            windowsHide: true,
            env: {
              ...spawnEnv,
              ...(agentName ? { OVERMIND_AGENT_NAME: agentName } : {}),
            },
          });

          // Register process immediately after spawn
          if (currentChild.pid) {
            void registerProcess(currentChild.pid, {
              agentName: agentName || '',
              runner: 'kilo',
              configPath: options.configPath,
            });
          }

          if (currentChild.stdout) {
            currentChild.stdout.on('data', (d: Buffer) => {
              const chunk = d.toString();

              // Append to live output buffer
              if (currentChild && currentChild.pid && chunk) {
                void appendOutput(currentChild.pid, chunk, options.configPath);
              }

              if (currentStdout.length + chunk.length > MAX_BUF)
                currentStdout = currentStdout.slice(-MAX_BUF);
              else currentStdout += chunk;

              const lines = chunk.split('\n');
              for (const line of lines) {
                const trimmedLine = line.trim();
                if (!trimmedLine) continue;

                try {
                  const event = JSON.parse(trimmedLine);

                  if (event.sessionID && !lastSessionId) {
                    lastSessionId = event.sessionID;
                    if (currentChild) {
                      void linkSessionToPid(event.sessionID, currentChild.pid!, options.configPath);
                    }
                  }

                  if (event.type === 'text' && event.part && event.part.text) {
                    finalResult += event.part.text;
                  } else if (event.type === 'message' || event.type === 'reply') {
                    finalResult += event.content || event.text || '';
                  } else if (event.type === 'session') {
                    if (!lastSessionId) {
                      lastSessionId = event.id || event.sessionID;
                      if (currentChild && lastSessionId) {
                        void linkSessionToPid(lastSessionId, currentChild.pid!, options.configPath);
                      }
                    } else {
                      lastSessionId = event.id || event.sessionID || lastSessionId;
                    }
                  } else if (event.type === 'error') {
                    currentStderr += (event.message || JSON.stringify(event)) + '\n';
                  }
                } catch (_e) {
                  if (!trimmedLine.startsWith('{') && !options.silent) {
                    process.stderr.write(`\x1b[36m[Kilo]\x1b[0m ${trimmedLine}\n`);
                  }
                }
              }
            });
          }

          if (currentChild.stderr) {
            currentChild.stderr.on('data', (d: Buffer) => {
              const chunk = d.toString();
              if (currentStderr.length + chunk.length > MAX_BUF)
                currentStderr = currentStderr.slice(-MAX_BUF);
              else currentStderr += chunk;

              const lowerChunk = chunk.toLowerCase();
              if (
                lowerChunk.includes('quota') ||
                lowerChunk.includes('exhausted') ||
                lowerChunk.includes('rate limit') ||
                chunk.includes('429')
              ) {
                process.stderr.write(
                  `\n\x1b[41m\x1b[37m[Kilo ALERT] QUOTA ATTEINT / MODÈLE ÉPUISÉ\x1b[0m\n`,
                );
                process.stderr.write(`\x1b[31m[Détail] ${chunk.trim()}\x1b[0m\n`);
              } else if (!options.silent) {
                process.stderr.write(`\x1b[31m[Kilo STDERR]\x1b[0m ${chunk}`);
              }
            });
          }

          const timeout = setTimeout(() => {
            if (currentChild && currentChild.stdin && !currentChild.stdin.destroyed) {
              try {
                currentChild.stdin.write('\n');
                if (!options.silent) {
                  process.stderr.write(
                    `\n\x1b[33m[Kilo] [WARN] Agent stagnant (${customTimeoutMs}ms). Envoi d'un keep-alive (\\n)...\x1b[0m\n`,
                  );
                }
              } catch (_e) {
                // ignore
              }
            }

            const hardTimeoutDelay = CONFIG.HARD_TIMEOUT_MS || 60000;
            hardTimeoutTimer = setTimeout(async () => {
              if (currentChild && currentChild.pid) await killProcessTree(currentChild.pid);
              else if (currentChild) currentChild.kill();
              killTimer = setTimeout(() => {
                if (currentChild && !currentChild.killed) currentChild.kill('SIGKILL');
              }, 5000);
              safeResolve({
                result: finalResult || currentStdout,
                error: 'HARD_TIMEOUT',
                rawOutput: currentStdout,
              });
            }, hardTimeoutDelay);
          }, customTimeoutMs);

          currentChild.on('error', (err: Error) => {
            clearTimeout(timeout);
            if (hardTimeoutTimer) clearTimeout(hardTimeoutTimer);
            safeResolve({ result: '', error: err.message, rawOutput: '' });
          });

          currentChild.on('close', async (code: number | null) => {
            clearTimeout(timeout);
            if (hardTimeoutTimer) clearTimeout(hardTimeoutTimer);

            // ─── Vérification 401 / Auth Error → Retry avec fallback ───
            if (code !== 0 && isAuthError(currentStderr)) {
              const tokenInfo = getTokenForIndex(retryCount);
              if (tokenInfo && retryCount < maxRetries) {
                retryCount++;
                if (!options.silent) {
                  process.stderr.write(
                    `\n\x1b[41m\x1b[37m[Kilo] 🔄 Auth error (401). Retry ${retryCount}/${maxRetries} avec ${tokenInfo.tokenEnvKey}...\x1b[0m\n`,
                  );
                }
                spawnWithToken(tokenInfo);
                return;
              } else {
                if (!options.silent) {
                  process.stderr.write(
                    `\n\x1b[41m\x1b[37m[Kilo] ❌ Tous les tokens fallback épuisés. Auth error finale.\x1b[0m\n`,
                  );
                }
                safeResolve({
                  result: '',
                  error: 'AUTH_ERROR_ALL_FALLBACKS_EXHAUSTED',
                  rawOutput: currentStdout + currentStderr,
                });
                return;
              }
            }

            if (code !== 0 && !finalResult && !currentStdout) {
              process.stderr.write(`\x1b[31m[Kilo] ❌ Échec avec Code: ${code}\x1b[0m\n`);
              return safeResolve({
                result: '',
                error: `EXIT_CODE_${code}`,
                rawOutput: currentStderr || currentStdout,
              });
            }

            process.stderr.write(
              `\x1b[32m[Kilo] ✅ Mission terminée (${((Date.now() - startTime) / 1000).toFixed(1)}s)\x1b[0m\n`,
            );

            if (currentChild && currentChild.pid) {
              void updateProcessStatus(
                currentChild.pid,
                code === 0 ? 'done' : 'failed',
                code,
                options.configPath,
              );
            }

            if (agentName && lastSessionId) {
              await saveSessionId(agentName, lastSessionId, options.configPath, 'kilo');
            }

            safeResolve({
              result: finalResult || currentStdout.trim(),
              sessionId: lastSessionId,
              rawOutput: currentStdout,
              model: selectedModel,
              nickname: originalModel !== selectedModel ? originalModel : undefined,
              fallbackUsed: retryCount > 0 ? FALLBACK_KEYS[retryCount - 1] : undefined,
            });
          });
        };

        // ─── Démarrage initial ───
        spawnWithToken(getTokenForIndex(0));
      });
    };

    return withSpan('kilo.runAgent', runImpl, {
      agentName: agentName || '',
      model: selectedModel || '',
      runner: 'kilo',
    });
  }
}
