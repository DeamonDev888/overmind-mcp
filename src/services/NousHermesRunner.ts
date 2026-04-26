import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { CONFIG, resolveConfigPath } from '../lib/config.js';
import { getLastSessionId } from '../lib/sessions.js';

export interface RunAgentOptions {
  prompt: string;
  agentName?: string;
  sessionId?: string;
  autoResume?: boolean;
  cwd?: string;
  configPath?: string;
  silent?: boolean;
  model?: string;
}

export interface RunAgentResult {
  result: string;
  sessionId?: string;
  error?: string;
  rawOutput?: string;
}

export class NousHermesRunner {
  private timeoutMs: number;

  constructor() {
    this.timeoutMs = CONFIG.TIMEOUT_MS || 900000; // 15 min default
  }

  async runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
    const { prompt, agentName, autoResume, silent } = options;
    let { sessionId } = options;

    // --- Auto Resume ---
    if (autoResume && agentName && !sessionId) {
      const lastId = await getLastSessionId(agentName, options.configPath);
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
          } catch (_e) {
            /* ignore */
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

        const settings = JSON.parse(fs.readFileSync(agentSettingsPath, 'utf8'));
        if (settings.env) {
          // Fusion intelligente : préserver les clés critiques (API keys)
          const criticalKeys = ['OPENROUTER_API_KEY', 'NVIDIA_API_KEY', 'NVIDIA_API_BASE', 'OVERMIND_EMBEDDING_KEY'];
          const envCopy = { ...settings.env };
          for (const key of criticalKeys) {
            if (agentCustomEnv[key] && !envCopy[key]) {
              envCopy[key] = agentCustomEnv[key];
            }
          }
          Object.assign(agentCustomEnv, envCopy);
        }

        // --- Load System Prompt (agents/agentName.md) ---
        const agentPromptPath = resolveConfigPath(
          path.join(path.dirname(settingsDir), 'agents', `${agentName}.md`),
          options.configPath,
        );

        if (fs.existsSync(agentPromptPath)) {
          systemPrompt = fs.readFileSync(agentPromptPath, 'utf8');
        }
      } catch (e: any) {
        if (e.message?.includes('INVALID_AGENT')) throw e;
        // Silent failing for others
      }
    }

    // --- CLI Arguments ---
    const finalPrompt = systemPrompt ? `${systemPrompt}\n\n[USER QUERY]:\n${prompt}` : prompt;

    // Nettoyer les sauts de ligne pour l'argument CLI (-q ne supporte pas les \n)
    // Hermes CLI avec shell:false peut échouer si l'argument contient des \n
    const cliPrompt = finalPrompt.replace(/\n+/g, ' ').trim();

    const cleanArgs = ['chat', '-q', cliPrompt, '--ignore-user-config', '--source', 'tool', '-Q'];

    // --- Model & Provider selection ---
    const DEFAULT_MODEL = 'tencent/hy3-preview:free'; // Modèle OpenRouter gratuit
    const model = options.model || DEFAULT_MODEL;

    const isNvidiaModel = model.includes('deepseek') || model.includes('nvidia');
    const hasNvidiaKey = !!(agentCustomEnv.NVIDIA_API_KEY || agentCustomEnv.NVAPI_KEY);

    cleanArgs.push('--model', model);

    if (isNvidiaModel && hasNvidiaKey) {
      if (!silent) console.error(`[NousHermesRunner] 🎯 Using NVIDIA NIM for ${model}`);
      cleanArgs.push('--provider', 'nvidia');
    } else {
      // Fallback OpenRouter pour tout le reste ou si clé NIM manquante
      if (!silent) console.error(`[NousHermesRunner] 🌐 Using OpenRouter for ${model}`);
      cleanArgs.push('--provider', 'openrouter');
    }

    // --- OS Specific Spawn ---
    const isWin = process.platform === 'win32';
    const hermesExe =
      'C:\\Users\\Deamon\\AppData\\Local\\Programs\\Python\\Python312\\Scripts\\hermes.exe';

    const spawnCommand = isWin ? hermesExe : 'hermes';

    if (!silent) {
      console.error(
        `[NousHermesRunner] 🚀 Starting Hermes Agent: ${spawnCommand} ${cleanArgs.join(' ')}`,
      );
    }

    return new Promise((resolve) => {
      const child: ChildProcess = spawn(spawnCommand, cleanArgs, {
        cwd: options.cwd || process.cwd(),
        shell: false, // FALSE: évite le découpage incorrect des arguments avec espaces sur Windows
        windowsHide: true,
        env: agentCustomEnv as NodeJS.ProcessEnv,
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (d: Buffer) => {
        const chunk = d.toString();
        stdout += chunk;
        if (!silent) {
          process.stderr.write(`[Hermes] ${chunk}`);
        }
      });

      child.stderr?.on('data', (d: Buffer) => {
        const chunk = d.toString();
        stderr += chunk;
        if (!silent) {
          process.stderr.write(`[Hermes:ERR] ${chunk}`);
        }
      });

      const timeout = setTimeout(() => {
        child.kill();
        resolve({ result: stdout.trim(), error: 'TIMEOUT', rawOutput: stdout });
      }, this.timeoutMs);

      child.on('close', async (code: number | null) => {
        clearTimeout(timeout);

        if (code !== 0 && !stdout) {
          return resolve({
            result: '',
            error: `EXIT_CODE_${code}`,
            rawOutput: stderr || stdout,
          });
        }

        // --- Session ID extraction ---
        // If hermes outputs a session ID in its output, we should extract it here.
        // For now, we'll return the sessionId we had.

        resolve({
          result: stdout.trim(),
          sessionId: sessionId,
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
