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
  'step 3.5 flash': 'stepfun/step-3.5-flash:free',
  'grok code fast 1 optimised': 'x-ai/grok-code-fast-1:optimized:free',
  'elephant': 'openrouter/elephant-alpha',
  'free': 'kilo-auto/free',
};

export class KiloRunner {
  private config: typeof CONFIG.KILO;
  private timeoutMs: number;

  constructor() {
    this.config = CONFIG.KILO;
    this.timeoutMs = CONFIG.TIMEOUT_MS || 30000;
  }

  async runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
    const { prompt, agentName, autoResume, mode } = options;
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

    // Build kilocode args: kilocode [options] "prompt"
    const argsSpawn: string[] = [];
    if (mode) argsSpawn.push(`--mode`, mode);
    if (sessionId) argsSpawn.push('--session', sessionId);
    if (selectedModel) argsSpawn.push('--model', selectedModel);
    
    // Required for non-interactive execution with stdin/stdout
    argsSpawn.push('--auto', '--json-io');
    argsSpawn.push(prompt);

    return new Promise((resolve) => {
      const isWin = process.platform === 'win32';
      // Try `kilo` binary first (global install), fallback to npx
      const command = isWin ? 'kilocode.cmd' : 'kilocode';

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
          await saveSessionId(agentName, sessionId);
        }

        resolve({
          result: stdout.trim(),
          sessionId,
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
