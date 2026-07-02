/**
 * HermesRunner — Thin wrapper around the native Hermes Agent CLI.
 *
 * ╔════════════════════════════════════════════════════════════════════════╗
 * ║  ARCHITECTURE (v3.0 — Refactored)                                       ║
 * ║                                                                          ║
 * ║  This runner replaces the 1391-line NousHermesRunner. It does NOT:       ║
 * ║    - Resolve tokens (Hermes .env per-profile does that)                  ║
 * ║    - Detect providers (Hermes config.yaml does that)                     ║
 * ║    - Manage HERMES_HOME custom paths (Hermes ~/.hermes native)           ║
 * ║    - Filter config.yaml (1 config per profile now)                       ║
 * ║    - Find the hermes binary (it's in PATH)                               ║
 * ║                                                                          ║
 * ║  It DOES:                                                                ║
 * ║    - Spawn: hermes -p <profile> chat -q "<prompt>" -Q --yolo             ║
 * ║    - Capture stdout (response) + stderr (session_id + diagnostics)       ║
 * ║    - Handle timeout + abort signal                                       ║
 * ║    - Register with agent_lifecycle + processRegistry (UI parity)         ║
 * ║                                                                          ║
 * ║  Profile management is handled by AgentManager via:                      ║
 * ║    hermes profile create / delete / list / show                          ║
 * ║                                                                          ║
 * ║  Session resume is handled by:                                           ║
 * ║    hermes -p <name> chat -q "<prompt>" --resume <sessionId>              ║
 * ╚════════════════════════════════════════════════════════════════════════╝
 */

import { spawn, type ChildProcess } from 'child_process';
import { CONFIG, getWorkspaceDir } from '../lib/config.js';
import { getLastSessionId, saveSessionId } from '../lib/sessions.js';
import { linkSessionToPid } from '../lib/processRegistry.js';
import { withSpan } from '../lib/telemetry.js';
import { rootLogger } from '../lib/logger.js';
import { registerProcess, updateProcessStatus } from '../lib/processRegistry.js';
import {
  registerLiveAgent,
  appendLiveOutput,
  setLiveStatus,
  unregisterLiveAgent,
} from '../lib/agent_lifecycle.js';
import { killProcessTree } from './hermes/processUtils.js';

const logger = rootLogger.child({ module: 'HermesRunner' });

export interface RunAgentOptions {
  prompt: string;
  agentName?: string;
  sessionId?: string;
  autoResume?: boolean;
  cwd?: string;
  configPath?: string;
  silent?: boolean;
  model?: string;
  provider?: string;
  signal?: AbortSignal;
}

export interface RunAgentResult {
  result: string;
  sessionId?: string;
  error?: string;
  rawOutput?: string;
  model?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Kill a child process tree, cross-platform. */
function killChildTree(child: ChildProcess): Promise<void> {
  return killProcessTree(child);
}

/** Extract session_id from Hermes stderr output. */
function extractSessionId(stderr: string): string | undefined {
  // Hermes outputs: "session_id: 20260628_114351_3fa469"
  const match = stderr.match(/session_id:\s*(\S+)/i);
  return match?.[1];
}

/** Check if an error output indicates a retryable failure. */
function isRetryableError(stderr: string, stdout: string): boolean {
  const combined = (stderr + ' ' + stdout).toLowerCase();
  return (
    combined.includes('401') ||
    combined.includes('unauthorized') ||
    combined.includes('invalid api key') ||
    combined.includes('authentication failed') ||
    combined.includes('429') ||
    combined.includes('rate limit') ||
    combined.includes('quota') ||
    combined.includes('503') ||
    combined.includes('service unavailable')
  );
}

// ─── Main Class ───────────────────────────────────────────────────────────────

export class HermesRunner {
  private timeoutMs: number;
  private MAX_BUF = 10 * 1024 * 1024; // 10MB buffer limit

  constructor() {
    this.timeoutMs = CONFIG.TIMEOUT_MS || 900000; // 15 min default
  }

  async runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
    if (options.agentName) {
      if (!/^[a-zA-Z0-9_-]+$/.test(options.agentName)) {
        return {
          result: '',
          error: `INVALID_AGENT_NAME: '${options.agentName}' contains invalid characters. Only [a-zA-Z0-9_-] allowed.`,
        };
      }
    }

    logger.info(
      { agentName: options.agentName, model: options.model, sessionId: options.sessionId },
      '[RUN_AGENT] Starting Hermes thin-wrapper run.',
    );

    try {
      const result = await withSpan(
        'hermes.runAgent',
        async (span) => {
          span.setAttribute('agentName', options.agentName || '');
          span.setAttribute('model', options.model || '');
          span.setAttribute('runner', 'hermes');
          return await this.runAgentInternal(options);
        },
        {
          agentName: options.agentName || '',
          model: options.model || '',
          runner: 'hermes',
        },
      );

      if (options.agentName && result.sessionId) {
        await saveSessionId(options.agentName, result.sessionId, options.configPath, 'hermes');
      }

      return result;
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          agentName: options.agentName,
        },
        '[RUN_AGENT] Hermes runner threw.',
      );
      throw error;
    }
  }

  private async runAgentInternal(options: RunAgentOptions): Promise<RunAgentResult> {
    const { prompt, agentName, silent } = options;
    let { sessionId } = options;
    const cwd = options.cwd || process.cwd();
    const configPath = options.configPath || getWorkspaceDir();

    // ─── Auto Resume ─────────────────────────────────────────────────────────
    if (options.autoResume && agentName && !sessionId) {
      const lastId = await getLastSessionId(agentName, configPath, 'hermes');
      if (lastId) {
        sessionId = lastId;
        logger.info({ sessionId }, '[RUN_AGENT] Auto-resume session.');
      }
    }

    // ─── Build CLI args ──────────────────────────────────────────────────────
    // Global flags come BEFORE the subcommand; subcommand flags come AFTER.
    //
    // hermes -p <profile> chat -q "<prompt>" -Q --yolo --pass-session-id
    //        ^^^^^^^^^^^      ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    //        profile           quiet query
    //
    const cleanArgs: string[] = [];

    // Profile selection — agentName maps to a Hermes profile
    if (agentName) {
      cleanArgs.push('-p', agentName);
    }

    // Subcommand
    cleanArgs.push('chat');

    // Query (non-interactive mode)
    cleanArgs.push('-q', prompt);

    // Quiet mode: suppress banner, spinner, tool previews
    cleanArgs.push('-Q');

    // Bypass all approval prompts (yolo mode — no human-in-the-loop)
    cleanArgs.push('--yolo');

    // Include session ID in output for extraction
    cleanArgs.push('--pass-session-id');

    // Tag as third-party integration (not shown in user session lists)
    cleanArgs.push('--source', 'tool');

    // Model override (optional — profile config.yaml is the default)
    if (options.model) {
      cleanArgs.push('--model', options.model);
    }

    // Provider override (optional — profile config.yaml is the default)
    if (options.provider) {
      cleanArgs.push('--provider', options.provider);
    }

    // Resume a previous session
    if (sessionId) {
      cleanArgs.push('--resume', sessionId);
    }

    // ─── Spawn ───────────────────────────────────────────────────────────────
    const timeoutMs = this.timeoutMs;
    const HARD_TIMEOUT_MS = 60000;
    let currentChildRef: ChildProcess | null = null;

    return new Promise((resolve) => {
      let resolved = false;
      let currentSessionId: string | undefined = sessionId;

      const abortListener = () => {
        if (currentChildRef) {
          killChildTree(currentChildRef).then(() => {
            safeResolve({ result: '', error: 'ABORTED', rawOutput: '' });
          });
        } else {
          safeResolve({ result: '', error: 'ABORTED', rawOutput: '' });
        }
      };

      const safeResolve = (v: RunAgentResult) => {
        if (!resolved) {
          resolved = true;
          if (options.signal) {
            options.signal.removeEventListener('abort', abortListener);
          }
          resolve(v);
        }
      };

      // ─── Spawn the Hermes process ──────────────────────────────────────────
      const child: ChildProcess = spawn('hermes', cleanArgs, {
        cwd,
        shell: false,
        windowsHide: true,
        env: {
          ...process.env,
          // Ensure Python uses UTF-8 (avoids Windows encoding crashes)
          PYTHONIOENCODING: 'utf-8',
          PYTHONUNBUFFERED: '1',
          TERM: 'emacs',
          // Disable interactive prompt_toolkit
          PROMPT_TOOLKIT_NO_INTERACTIVE: '1',
        },
      });
      currentChildRef = child;

      if (child.pid) {
        void registerProcess(child.pid, {
          agentName: agentName || '',
          runner: 'hermes',
          configPath,
        });
        void registerLiveAgent({
          pid: child.pid,
          runner: 'hermes',
          agentName: agentName || '',
          sessionId: currentSessionId || '',
          cleanupFn: async () => {
            await killChildTree(child);
          },
          childRef: child,
        });
        child.once('exit', (code) => {
          setLiveStatus(child.pid!, code === 0 ? 'done' : 'failed', code ?? null);
          void unregisterLiveAgent(child.pid!);
        });
      }

      // ─── Capture output ────────────────────────────────────────────────────
      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (d: Buffer) => {
        const chunk = d.toString();
        if (child.pid) {
          void appendLiveOutput(child.pid, chunk);
        }
        if (stdout.length + chunk.length > this.MAX_BUF) {
          stdout = stdout.slice(-this.MAX_BUF);
        } else {
          stdout += chunk;
        }
        if (!silent && agentName) {
          process.stderr.write(`[Hermes:${agentName}] ${chunk}`);
        }
      });

      child.stderr?.on('data', (d: Buffer) => {
        const chunk = d.toString();
        if (stderr.length + chunk.length > this.MAX_BUF) {
          stderr = stderr.slice(-this.MAX_BUF);
        } else {
          stderr += chunk;
        }
        if (!silent && agentName) {
          process.stderr.write(`[Hermes:${agentName}:ERR] ${chunk}`);
        }
      });

      // ─── Timeout ───────────────────────────────────────────────────────────
      const timer = setTimeout(() => {
        if (child.stdin && !child.stdin.destroyed) {
          try {
            child.stdin.write('\n');
          } catch {
            /* ignore */
          }
        }
        setTimeout(async () => {
          await killChildTree(child);
          safeResolve({ result: '', error: 'HARD_TIMEOUT', rawOutput: stdout + stderr });
        }, HARD_TIMEOUT_MS);
      }, timeoutMs);

      // ─── Process exit ──────────────────────────────────────────────────────
      child.on('close', async (code: number | null) => {
        clearTimeout(timer);

        if (child.pid) {
          void updateProcessStatus(child.pid, code === 0 ? 'done' : 'failed', code, configPath);
        }

        // Extract session_id from stderr
        const extractedSid = extractSessionId(stderr);
        if (extractedSid) {
          currentSessionId = extractedSid;
        }

        // Save session linkage
        if (currentSessionId && agentName) {
          await saveSessionId(agentName, currentSessionId, configPath, 'hermes');
          if (child.pid) {
            void linkSessionToPid(currentSessionId, child.pid, configPath);
          }
        }

        // ─── Error handling ──────────────────────────────────────────────────
        if (code !== 0) {
          const retryable = isRetryableError(stderr, stdout);
          if (retryable) {
            // Surface the error — the caller (run_hermes.ts) handles session cleanup + retry
            logger.warn(
              { agentName, code, retryable, sessionId: currentSessionId },
              '[RUN_AGENT] Hermes exited with retryable error.',
            );
          }

          if (!stdout.trim()) {
            safeResolve({
              result: '',
              error: `EXIT_CODE_${code}`,
              rawOutput: stderr || stdout,
              sessionId: currentSessionId,
            });
            return;
          }
        }

        // ─── Success ─────────────────────────────────────────────────────────
        safeResolve({
          result: stdout.trim(),
          sessionId: currentSessionId,
          rawOutput: stdout,
        });
      });

      child.on('error', (err: Error) => {
        clearTimeout(timer);
        killChildTree(child).then(() => {
          safeResolve({
            result: '',
            error: `SPAWN_ERROR: ${err.message}`,
            rawOutput: '',
          });
        });
      });

      // ─── Abort signal ──────────────────────────────────────────────────────
      if (options.signal) {
        if (options.signal.aborted) {
          killChildTree(child).then(() => {
            safeResolve({ result: '', error: 'ABORTED', rawOutput: '' });
          });
          return;
        }
        options.signal.addEventListener('abort', abortListener);
      }
    });
  }
}
