import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { CONFIG, resolveConfigPath } from '../lib/config.js';
import { getLastSessionId, saveSessionId } from '../lib/sessions.js';
import { interpolateEnvVars } from '../lib/envUtils.js';
import { PromptManager } from './PromptManager.js';
import { resolveKiloModel } from '../lib/modelMapping.js';

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
}

const CLAUDE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class KiloRunner {
  private config: typeof CONFIG.KILO;
  private timeoutMs: number;

  static INSTALL_INSTRUCTIONS = `
💡 **Comment installer/mettre à jour Kilo Code v7.2.14 :**

**Option A — VS Code (Recommandé)**
1. Dans VS Code, Extensions (Ctrl+Shift+X)
2. Recherchez "Kilo Code" par "kilocode"
3. Ou via terminal : \`code --install-extension kilocode.Kilo-Code\`

**Option B — CLI Standalone (Binaire)**
1. Téléchargez \`kilo-windows-x64.zip\` depuis : https://github.com/Kilo-Org/kilocode/releases
2. Extrayez \`kilo.exe\` et placez-le dans un dossier de votre PATH (ex: \`C:\\Users\\Deamon\\AppData\\Roaming\\npm\\\`)

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
    const { prompt, agentName, autoResume, mode, cwd } = options;
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

    if (sessionId && !CLAUDE_UUID_RE.test(sessionId)) {
      argsSpawn.push('--session', sessionId);
    }
    if (selectedModel) argsSpawn.push('--model', selectedModel);

    // Required for non-interactive execution
    argsSpawn.push('--auto');
    argsSpawn.push('--format', 'json');

    if (cwd) {
      argsSpawn.push('--dir', cwd);
    }

    return new Promise((resolve) => {
      let resolved = false;
      const safeResolve = (value: RunAgentResult) => {
        if (!resolved) {
          resolved = true;
          resolve(value);
        }
      };

      const command = 'kilo';

      if (!options.silent) {
        process.stderr.write(
          `\n\x1b[33m[Kilo] ⚡ Initialisation de l'agent: ${agentName || 'Anonyme'}\x1b[0m\n`,
        );
        process.stderr.write(`\x1b[33m[Kilo] 🤖 Modèle: ${selectedModel}\x1b[0m\n`);
        if (mode) process.stderr.write(`\x1b[33m[Kilo] 🛠️ Mode/Agent: ${mode}\x1b[0m\n`);
        if (sessionId && !CLAUDE_UUID_RE.test(sessionId))
          process.stderr.write(`\x1b[33m[Kilo] 📜 Session: ${sessionId}\x1b[0m\n`);

        process.stderr.write(
          `\x1b[33m[Kilo] 🚀 Commande: ${command} ${argsSpawn.join(' ')}\x1b[0m\n`,
        );
      }
      const child: ChildProcess = spawn(command, argsSpawn, {
        cwd: options.cwd || process.cwd(),
        shell: false,
        windowsHide: true,
        env: {
          ...process.env,
          ...agentCustomEnv,
          ...(agentName ? { OVERMIND_AGENT_NAME: agentName } : {}),
        },
      });

      let stdout = '';
      let stderr = '';
      let finalResult = '';
      let lastSessionId = sessionId;

      if (child.stdout) {
        child.stdout.on('data', (d: Buffer) => {
          const chunk = d.toString();
          stdout += chunk;

          const lines = chunk.split('\n');
          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;

            try {
              const event = JSON.parse(trimmedLine);

              if (event.sessionID && !lastSessionId) {
                lastSessionId = event.sessionID;
              }

              if (event.type === 'text' && event.part && event.part.text) {
                finalResult += event.part.text;
              } else if (event.type === 'message' || event.type === 'reply') {
                finalResult += event.content || event.text || '';
              } else if (event.type === 'session') {
                lastSessionId = event.id || event.sessionID || lastSessionId;
              } else if (event.type === 'error') {
                stderr += (event.message || JSON.stringify(event)) + '\n';
              }
            } catch (_e) {
              if (!trimmedLine.startsWith('{') && !options.silent) {
                process.stderr.write(`\x1b[36m[Kilo]\x1b[0m ${trimmedLine}\n`);
              }
            }
          }
        });
      }

      if (child.stderr) {
        child.stderr.on('data', (d: Buffer) => {
          const chunk = d.toString();
          stderr += chunk;

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

      let killTimer: NodeJS.Timeout | null = null;
      let hardTimeoutTimer: NodeJS.Timeout | null = null;

      const timeout = setTimeout(() => {
        // 1. Send keep-alive input (\n)
        if (child.stdin && !child.stdin.destroyed) {
          try {
            child.stdin.write('\n');
            if (!options.silent) {
              process.stderr.write(
                `\n\x1b[33m[Kilo] [WARN] Agent stagnant (${customTimeoutMs}ms). Envoi d'un keep-alive (\\n)...\x1b[0m\n`,
              );
            }
          } catch (_e) {
            // ignore
          }
        }

        // 2. Schedule HARD timeout
        const hardTimeoutDelay = CONFIG.HARD_TIMEOUT_MS || 60000;
        hardTimeoutTimer = setTimeout(() => {
          child.kill();
          killTimer = setTimeout(() => {
            if (!child.killed) child.kill('SIGKILL');
          }, 5000);
          safeResolve({ result: finalResult || stdout, error: 'HARD_TIMEOUT', rawOutput: stdout });
        }, hardTimeoutDelay);
      }, customTimeoutMs);

      const clearAllTimers = () => {
        clearTimeout(timeout);
        if (hardTimeoutTimer) clearTimeout(hardTimeoutTimer);
        if (killTimer) clearTimeout(killTimer);
      };

      child.on('close', async (code: number | null) => {
        clearAllTimers();
        if (code !== 0 && !finalResult && !stdout) {
          process.stderr.write(`\x1b[31m[Kilo] ❌ Échec avec Code: ${code}\x1b[0m\n`);
          return safeResolve({
            result: '',
            error: `EXIT_CODE_${code}`,
            rawOutput: stderr || stdout,
          });
        }

        process.stderr.write(
          `\x1b[32m[Kilo] ✅ Mission terminée (${((Date.now() - startTime) / 1000).toFixed(1)}s)\x1b[0m\n`,
        );

        if (agentName && lastSessionId) {
          await saveSessionId(agentName, lastSessionId, options.configPath, 'kilo');
        }

        safeResolve({
          result: finalResult || stdout.trim(),
          sessionId: lastSessionId,
          rawOutput: stdout,
          model: selectedModel,
          nickname: originalModel !== selectedModel ? originalModel : undefined,
        });
      });

      child.on('error', (err: Error) => {
        clearAllTimers();
        safeResolve({ result: '', error: err.message, rawOutput: '' });
      });

      if (child.stdin) {
        // child.stdin.end(); // Keep open for keep-alive
      }
    });
  }
}
