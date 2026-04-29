import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { CONFIG, resolveConfigPath } from '../lib/config.js';
import { getLastSessionId, saveSessionId } from '../lib/sessions.js';
import { interpolateEnvVars } from '../lib/envUtils.js';

export interface RunAgentOptions {
  prompt: string;
  agentName?: string;
  sessionId?: string;
  autoResume?: boolean;
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

export class QwenCLIRunner {
  private config: typeof CONFIG.CLAUDE;
  private timeoutMs: number;

  constructor() {
    this.config = CONFIG.CLAUDE;
    this.timeoutMs = CONFIG.TIMEOUT_MS || 900000;
  }

  async runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
    const { prompt, agentName, autoResume } = options;
    let { sessionId } = options;
    const { PATHS } = this.config;

    // --- Auto Resume ---
    if (autoResume && agentName && !sessionId) {
      const lastId = await getLastSessionId(agentName, options.configPath, 'qwencli');
      if (lastId) {
        sessionId = lastId;
      }
    }

    let customTimeoutMs = this.timeoutMs;

    // --- Isolation ---
    if (agentName) {
      try {
        const agentSettingsPath = resolveConfigPath(
          path.join(path.dirname(PATHS.SETTINGS), `settings_${agentName}.json`),
          options.configPath
        );
        if (fs.existsSync(agentSettingsPath)) {
          let settings = JSON.parse(fs.readFileSync(agentSettingsPath, 'utf8'));
          
          // --- New interpolation logic ---
          settings = interpolateEnvVars(settings);
          
          if (settings.env && settings.env.AGENT_TIMEOUT_MS) {
            customTimeoutMs = parseInt(settings.env.AGENT_TIMEOUT_MS, 10) || customTimeoutMs;
          }
        }
      } catch (_e) {
        // silent
      }
    }

    // qwen-code CLI: `qwen -p "prompt"` (non-interactive mode via stdin)
    const argsSpawn: string[] = ['-p', prompt];

    return new Promise((resolve) => {
      const isWin = process.platform === 'win32';
      // `qwen` binary from @qwen-code/qwen-code global install
      const command = isWin ? 'qwen.cmd' : 'qwen';

      const child: ChildProcess = spawn(command, argsSpawn, {
        cwd: options.cwd || process.cwd(),
        shell: isWin,
        windowsHide: true,
        env: {
          ...process.env,
          ...(agentName ? { OVERMIND_AGENT_NAME: agentName } : {}),
        },
      });

      let stdout = '';
      let stderr = '';

      if (child.stdout) child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
      if (child.stderr) child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));

      const timeout = setTimeout(() => {
        child.kill();
        resolve({ result: '', error: 'TIMEOUT', rawOutput: stdout });
      }, customTimeoutMs);

      child.on('close', async (code: number | null) => {
        clearTimeout(timeout);

        if (code !== 0 && !stdout) {
          return resolve({ result: '', error: `EXIT_CODE_${code}`, rawOutput: stderr });
        }

        if (agentName && sessionId) {
          await saveSessionId(agentName, sessionId, options.configPath, 'qwencli');
        }

        resolve({
          result: stdout.trim(),
          sessionId,
          rawOutput: stdout,
        });
      });

      child.on('error', (err: Error) => {
        resolve({ result: '', error: err.message, rawOutput: '' });
      });

      if (child.stdin) child.stdin.end();
    });
  }
}
