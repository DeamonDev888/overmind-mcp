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
      ...(agentName ? { OVERMIND_AGENT_NAME: agentName } : {}),
    };

    // --- Isolation / Settings ---
    // Note: Hermes uses its own config system, but we can pass env vars if needed.
    if (agentName) {
      try {
        const settingsDir = path.dirname(CONFIG.CLAUDE.PATHS.SETTINGS);
        const agentSettingsPath = resolveConfigPath(
          path.join(settingsDir, `settings_${agentName}.json`),
          options.configPath
        );
        
        if (fs.existsSync(agentSettingsPath)) {
          const settings = JSON.parse(fs.readFileSync(agentSettingsPath, 'utf8'));
          if (settings.env) {
            Object.assign(agentCustomEnv, settings.env);
          }
        }
      } catch (_e) {
        // Silent failing
      }
    }

    // --- CLI Arguments ---
    // Based on research: hermes chat -q "prompt"
    // We'll try to find a way to pass session if possible, otherwise we rely on internal hermes history.
    const argsSpawn: string[] = ['chat', '-q', `"${prompt.replace(/"/g, '\\"')}"`, '--ignore-user-config', '--source', 'tool'];
    if (options.model) {
      argsSpawn.push('--model', options.model);
    }

    // Note: If hermes supports --session or --resume in CLI, we should add it here.
    // For now, we'll assume -q is the standard for single-shot.

    return new Promise((resolve) => {
      const isWin = process.platform === 'win32';
      // Use the absolute path discovered earlier for reliability on Windows
      const command = isWin 
        ? 'C:\\Users\\Deamon\\AppData\\Local\\Programs\\Python\\Python312\\Scripts\\hermes.exe' 
        : 'hermes';

      if (!silent) {
        console.error(`[NousHermesRunner] 🚀 Starting Hermes Agent...`);
      }

      // We remove the manual quotes here because shell: false handles it correctly via the array
      const cleanArgs = ['chat', '-q', prompt, '--ignore-user-config', '--source', 'tool'];
      if (options.model) {
        cleanArgs.push('--model', options.model);
      }

      const child: ChildProcess = spawn(command, cleanArgs, {
        cwd: options.cwd || process.cwd(),
        shell: false,
        windowsHide: true, // Désormais sûr grâce au patch de cli.py
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
            rawOutput: stderr || stdout 
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
