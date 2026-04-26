import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { CONFIG, resolveConfigPath } from '../lib/config.js';
import { getLastSessionId, saveSessionId } from '../lib/sessions.js';

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
}

const MODEL_MAPPING: Record<string, string> = {
  'tencent hy3': 'kilo/tencent/hy3-preview:free',
  'step 3.5 flash': 'kilo/stepfun/step-3.5-flash:free',
  'grok code': 'kilo/x-ai/grok-code-fast-1:optimized:free',
  'grok code fast 1 optimised': 'kilo/x-ai/grok-code-fast-1:optimized:free',
  elephant: 'kilo/openrouter/elephant-alpha',
  free: 'kilo/openrouter/free',
};

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
      const lastId = await getLastSessionId(agentName, options.configPath);
      if (lastId) {
        sessionId = lastId;
      }
    }

    let customTimeoutMs = this.timeoutMs;
    let selectedModel = model || DEFAULT_MODEL;

    // --- Isolation ---
    if (agentName) {
      try {
        const agentSettingsPath = resolveConfigPath(
          path.join(path.dirname(PATHS.SETTINGS), `settings_${agentName}.json`),
          options.configPath,
        );
        if (fs.existsSync(agentSettingsPath)) {
          const settings = JSON.parse(fs.readFileSync(agentSettingsPath, 'utf8'));
          if (settings.env) {
            Object.assign(agentCustomEnv, settings.env);
            if (settings.env.AGENT_TIMEOUT_MS) {
              customTimeoutMs = parseInt(settings.env.AGENT_TIMEOUT_MS, 10) || customTimeoutMs;
            }
            if (!model && settings.env.KILO_MODEL) {
              selectedModel = settings.env.KILO_MODEL;
            }
          }
        }
      } catch (_e) {
        // silent
      }
    }

    // Apply mapping
    if (MODEL_MAPPING[selectedModel]) {
      selectedModel = MODEL_MAPPING[selectedModel];
    } else if (model && MODEL_MAPPING[model]) {
      selectedModel = MODEL_MAPPING[model];
    }

    // Build kilo args: kilo run [prompt] [options]
    const argsSpawn: string[] = ['run'];

    // Le prompt est un argument positionnel pour 'run'
    argsSpawn.push(prompt);

    if (mode) {
      // Dans v7.x, les modes code/architect sont souvent des agents prédéfinis
      argsSpawn.push('--agent', mode);
    }

    // if (sessionId) argsSpawn.push('--session', sessionId);
    if (selectedModel) argsSpawn.push('--model', selectedModel);

    // Required for non-interactive execution
    argsSpawn.push('--auto');
    argsSpawn.push('--format', 'json');

    if (cwd) {
      argsSpawn.push('--dir', '.');
    }

    return new Promise((resolve) => {
      const command = 'kilo';

      if (!options.silent) {
        process.stderr.write(
          `\n\x1b[33m[Kilo] ⚡ Initialisation de l'agent: ${agentName || 'Anonyme'}\x1b[0m\n`,
        );
        process.stderr.write(`\x1b[33m[Kilo] 🤖 Modèle: ${selectedModel}\x1b[0m\n`);
        if (mode) process.stderr.write(`\x1b[33m[Kilo] 🛠️ Mode/Agent: ${mode}\x1b[0m\n`);
        // if (sessionId) process.stderr.write(`\x1b[33m[Kilo] 📜 Session: ${sessionId}\x1b[0m\n`);

        process.stderr.write(`\x1b[33m[Kilo] 🚀 Commande: ${command} ${argsSpawn.join(' ')}\x1b[0m\n`);
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

          // Traitement par ligne pour le format JSON
          const lines = chunk.split('\n');
          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;

            try {
              const event = JSON.parse(trimmedLine);

              // Tracking du sessionID dans n'importe quel event
              if (event.sessionID && !lastSessionId) {
                lastSessionId = event.sessionID;
              }

              // Kilo v7 JSON events tracking
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
              // Si ce n'est pas du JSON, c'est peut-être du log
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

          // DÉTECTION QUOTA / EXHAUSTED
          const lowerChunk = chunk.toLowerCase();
          if (
            lowerChunk.includes('quota') ||
            lowerChunk.includes('exhausted') ||
            lowerChunk.includes('rate limit') ||
            chunk.includes('429')
          ) {
            process.stderr.write(`\n\x1b[41m\x1b[37m[Kilo ALERT] QUOTA ATTEINT / MODÈLE ÉPUISÉ\x1b[0m\n`);
            process.stderr.write(`\x1b[31m[Détail] ${chunk.trim()}\x1b[0m\n`);
          } else if (!options.silent) {
            process.stderr.write(`\x1b[31m[Kilo STDERR]\x1b[0m ${chunk}`);
          }
        });
      }

      const timeout = setTimeout(() => {
        child.kill();
        resolve({ result: finalResult || stdout, error: 'TIMEOUT', rawOutput: stdout });
      }, customTimeoutMs);

      child.on('close', async (code: number | null) => {
        clearTimeout(timeout);

        if (code !== 0 && !finalResult && !stdout) {
          process.stderr.write(`\x1b[31m[Kilo] ❌ Échec avec Code: ${code}\x1b[0m\n`);
          return resolve({ result: '', error: `EXIT_CODE_${code}`, rawOutput: stderr || stdout });
        }

        process.stderr.write(
          `\x1b[32m[Kilo] ✅ Mission terminée (${((Date.now() - startTime) / 1000).toFixed(1)}s)\x1b[0m\n`,
        );

        if (agentName && lastSessionId) {
          await saveSessionId(agentName, lastSessionId, options.configPath);
        }

        resolve({
          result: finalResult || stdout.trim(),
          sessionId: lastSessionId,
          rawOutput: stdout,
        });
      });

      child.on('error', (err: Error) => {
        clearTimeout(timeout);
        resolve({ result: '', error: err.message, rawOutput: '' });
      });

      if (child.stdin) {
        child.stdin.end();
      }
    });
  }
}
