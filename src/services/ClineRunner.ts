import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { CONFIG, resolveConfigPath } from '../lib/config.js';
import { getLastSessionId, saveSessionId } from '../lib/sessions.js';
import { interpolateEnvVars } from '../lib/envUtils.js';
import { withSpan } from '../lib/telemetry.js';
import pino from 'pino';
import {
  registerProcess,
  appendOutput,
  updateProcessStatus,
  killProcessTree,
} from '../lib/processRegistry.js';

const logger = pino({ name: 'ClineRunner' });

export interface RunAgentOptions {
  prompt: string;
  agentName?: string;
  sessionId?: string;
  autoResume?: boolean;
  mode?: 'plan' | 'act';
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

export class ClineRunner {
  private config: typeof CONFIG.CLAUDE;
  private timeoutMs: number;
  private MAX_BUF = 10 * 1024 * 1024; // 10MB

  constructor() {
    this.config = CONFIG.CLAUDE;
    this.timeoutMs = CONFIG.TIMEOUT_MS || 900000;
  }

  async runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
    if (options.agentName) {
      // Inline validation — prevents path traversal on settings_${agentName}.json
      if (!/^[a-zA-Z0-9_-]+$/.test(options.agentName)) {
        return { result: '', error: `INVALID_AGENT_NAME: '${options.agentName}' contains invalid characters. Only [a-zA-Z0-9_-] allowed.` };
      }
    }
    return withSpan('cline.runAgent', async (span) => {
      span.setAttribute('agentName', options.agentName || '');
      span.setAttribute('runner', 'cline');
      span.setAttribute('mode', options.mode || '');

      const result = await this.runAgentInternal(options);

      if (options.agentName && result.sessionId) {
        await saveSessionId(options.agentName, result.sessionId, options.configPath, 'cline');
      }

      return result;
    }, { agentName: options.agentName || '', runner: 'cline', mode: options.mode || '' });
  }

  private async runAgentInternal(options: RunAgentOptions): Promise<RunAgentResult> {
    const { prompt, agentName, autoResume, mode } = options;
    let { sessionId } = options;
    const { PATHS } = this.config;

    // --- Auto Resume ---
    if (autoResume && agentName && !sessionId) {
      const lastId = await getLastSessionId(agentName, options.configPath, 'cline');
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
          options.configPath,
        );
        if (fs.existsSync(agentSettingsPath)) {
          let settings = JSON.parse(fs.readFileSync(agentSettingsPath, 'utf8'));

          // --- New interpolation logic ---
          settings = interpolateEnvVars(settings);

          if (settings.env && settings.env.AGENT_TIMEOUT_MS) {
            customTimeoutMs = parseInt(settings.env.AGENT_TIMEOUT_MS, 10) || customTimeoutMs;
          }
        }
      } catch (err) {
        logger.warn({ agentName, error: err }, 'Failed to load agent settings');
      }
    }

    // Cline CLI: `cline -y "prompt"` (-y = autonomous, no interactive UI)
    // Optionally `--mode plan|act`
    const argsSpawn: string[] = ['-y'];
    if (mode) argsSpawn.push('--mode', mode);
    if (sessionId) argsSpawn.push('--resume', sessionId);
    argsSpawn.push(prompt);

    return new Promise((resolve) => {
      const isWin = process.platform === 'win32';
      const command = isWin ? 'cline.cmd' : 'cline';

      const child: ChildProcess = spawn(command, argsSpawn, {
        cwd: options.cwd || process.cwd(),
        shell: isWin,
        windowsHide: true,
        env: {
          ...process.env,
          ...(agentName ? { OVERMIND_AGENT_NAME: agentName } : {}),
        },
      });

      if (child.pid) {
        void registerProcess(child.pid, { agentName: agentName || '', runner: 'cline', configPath: options.configPath });
      }

      let stdout = '';
      let stderr = '';
      let hardTimeoutTimer: NodeJS.Timeout | null = null;

      const cleanup = () => {
        child.stdout?.removeAllListeners();
        child.stderr?.removeAllListeners();
        child.removeAllListeners();
        if (hardTimeoutTimer) clearTimeout(hardTimeoutTimer);
      };

      if (child.stdout)
        child.stdout.on('data', (d: Buffer) => {
          const chunk = d.toString();
          if (child.pid) void appendOutput(child.pid, chunk, options.configPath);
          if (stdout.length + d.length > this.MAX_BUF) stdout = stdout.slice(-this.MAX_BUF);
          else stdout += chunk;
        });
      if (child.stderr)
        child.stderr.on('data', (d: Buffer) => {
          if (stderr.length + d.length > this.MAX_BUF) stderr = stderr.slice(-this.MAX_BUF);
          else stderr += d.toString();
        });

      const timeout = setTimeout(async () => {
        // Use killProcessTree to prevent zombie processes on Windows
        if (child.pid) await killProcessTree(child.pid);
        else child.kill('SIGTERM');
        hardTimeoutTimer = setTimeout(async () => {
          if (!child.killed) {
            if (child.pid) await killProcessTree(child.pid);
            else child.kill('SIGKILL');
          }
        }, 5000);
        // Don't call cleanup() here — let the 'close' handler do it
        if (child.pid) void updateProcessStatus(child.pid, 'failed', null, options.configPath);
        resolve({ result: '', error: 'TIMEOUT', rawOutput: stdout });
      }, customTimeoutMs);

      child.on('close', async (code: number | null) => {
        clearTimeout(timeout);
        cleanup(); // Moved here: cleanup after process actually exits
        if (child.pid) void updateProcessStatus(child.pid, code === 0 ? 'done' : 'failed', code, options.configPath);

        if (code !== 0 && !stdout) {
          return resolve({ result: '', error: `EXIT_CODE_${code}`, rawOutput: stderr });
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
