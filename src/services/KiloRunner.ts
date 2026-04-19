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
}

export interface RunAgentResult {
  result: string;
  sessionId?: string;
  error?: string;
  rawOutput?: string;
}

const MODEL_MAPPING: Record<string, string> = {
  'step 3.5 flash': 'kilo/stepfun/step-3.5-flash:free',
  'grok code': 'kilo/x-ai/grok-code-fast-1:optimized:free',
  'grok code fast 1 optimised': 'kilo/x-ai/grok-code-fast-1:optimized:free',
  'elephant': 'kilo/openrouter/elephant-alpha',
  'free': 'kilo/openrouter/free',
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
    this.timeoutMs = CONFIG.TIMEOUT_MS || 300000; // Augmenté à 5 min par défaut pour les tâches complexes
  }

  async verifyInstallation(): Promise<{ ok: boolean; message?: string }> {
    const REQUIRED_VERSION = '7.2.14';
    const { exec } = await import('child_process');
    return new Promise((resolve) => {
      exec('kilo --version', (error, stdout) => {
        if (error) {
          return resolve({
            ok: false,
            message: `❌ **Kilo CLI introuvable !**\n\nL'exécutable 'kilo' n'est pas installé ou n'est pas dans votre PATH.\n${KiloRunner.INSTALL_INSTRUCTIONS}`
          });
        }
        const version = stdout.trim();
        // Vérification flexible : soit la version exacte, soit une version 7.x
        if (!version.includes(REQUIRED_VERSION) && !version.startsWith('7.')) {
          return resolve({
            ok: false,
            message: `⚠️ **Version Incorrecte détectée : ${version}** (Attendu: ${REQUIRED_VERSION})\n\nIl est fortement recommandé de mettre à jour vers la version officielle v7.x.\n${KiloRunner.INSTALL_INSTRUCTIONS}`
          });
        }
        resolve({ ok: true });
      });
    });
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
      const lastId = await getLastSessionId(agentName);
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
          options.configPath
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
    
    if (sessionId) argsSpawn.push('--session', sessionId);
    if (selectedModel) argsSpawn.push('--model', selectedModel);
    
    // Required for non-interactive execution
    argsSpawn.push('--auto');
    argsSpawn.push('--format', 'json');

    if (cwd) {
      argsSpawn.push('--dir', cwd);
    }

    return new Promise((resolve) => {
      const isWin = process.platform === 'win32';
      const command = 'kilo';

      console.log(`\n\x1b[33m[Kilo] ⚡ Initialisation de l'agent: ${agentName || 'Anonyme'}\x1b[0m`);
      console.log(`\x1b[33m[Kilo] 🤖 Modèle: ${selectedModel}\x1b[0m`);
      if (mode) console.log(`\x1b[33m[Kilo] 🛠️ Mode/Agent: ${mode}\x1b[0m`);
      if (sessionId) console.log(`\x1b[33m[Kilo] 📜 Session: ${sessionId}\x1b[0m`);

      const child: ChildProcess = spawn(command, argsSpawn, {
        cwd: options.cwd || process.cwd(),
        shell: isWin,
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
                finalResult += (event.content || event.text || '');
              } else if (event.type === 'session') {
                lastSessionId = event.id || event.sessionID || lastSessionId;
              } else if (event.type === 'error') {
                stderr += (event.message || JSON.stringify(event)) + '\n';
              }
            } catch (_e) {
              // Si ce n'est pas du JSON, c'est peut-être du log
              if (!trimmedLine.startsWith('{')) {
                process.stdout.write(`\x1b[36m[Kilo]\x1b[0m ${trimmedLine}\n`);
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
          if (lowerChunk.includes('quota') || 
              lowerChunk.includes('exhausted') || 
              lowerChunk.includes('rate limit') ||
              chunk.includes('429')) {
            console.log(`\n\x1b[41m\x1b[37m[Kilo ALERT] QUOTA ATTEINT / MODÈLE ÉPUISÉ\x1b[0m`);
            console.log(`\x1b[31m[Détail] ${chunk.trim()}\x1b[0m`);
          } else {
            process.stdout.write(`\x1b[31m[Kilo STDERR]\x1b[0m ${chunk}`);
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
          console.log(`\x1b[31m[Kilo] ❌ Échec avec Code: ${code}\x1b[0m`);
          return resolve({ result: '', error: `EXIT_CODE_${code}`, rawOutput: stderr || stdout });
        }

        console.log(`\x1b[32m[Kilo] ✅ Mission terminée (${((Date.now() - startTime) / 1000).toFixed(1)}s)\x1b[0m`);

        if (agentName && lastSessionId) {
          await saveSessionId(agentName, lastSessionId);
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

