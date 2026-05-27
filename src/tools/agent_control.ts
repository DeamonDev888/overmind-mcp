import { z } from 'zod';
import { getProcessStatus, killAgent } from '../lib/processRegistry.js';
import { ProcessEntry } from '../lib/processRegistry.js';
import {
  getLiveAgent,
  getLiveAgentByPid,
  LiveAgent,
  LifecycleStatus,
} from '../lib/agent_lifecycle.js';

// ─── Schema + Types ──────────────────────────────────────────────────────────

export const agentControlSchema = z
  .object({
    agentName: z.string().describe("Nom unique de l'agent à contrôler"),
    runner: z
      .enum(['claude', 'gemini', 'kilo', 'qwencli', 'openclaw', 'cline', 'opencode', 'hermes'])
      .optional()
      .describe("Type de runner (optionnel — déduit si omis)"),
    config: z.string().optional().describe('Chemin racine Overmind'),
    action: z
      .enum(['status', 'stream', 'kill', 'wait'])
      .describe(
        'status — état courant (pid, status, sessionId, output)\n' +
          'stream — output en temps réel + isComplete\n' +
          'kill   — arrêt forcé du process tree\n' +
          'wait   — bloque jusquà terminaison (max timeoutMs)',
      ),
    timeoutMs: z
      .number()
      .int()
      .min(1000)
      .max(3600000)
      .optional()
      .default(900000)
      .describe('Timeout wait en ms (défaut: 900s, max: 1h)'),
    sinceTimestamp: z.number().optional().describe('Pour stream: output après ce timestamp'),
  });

export type AgentControlArgs = z.infer<typeof agentControlSchema>;

interface ControlResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

// ─── Unified agent view ────────────────────────────────────────────────────────

/** Merged view for status/stream — works with in-memory LiveAgent or disk ProcessEntry */
interface AgentView {
  agentName: string;
  runner?: string;
  status: LifecycleStatus;
  pid?: number;
  sessionId?: string;
  exitCode: number | null;
  outputBuffer: string;
  startedAt: number;
  lastOutputAt: number;
}

/** Try in-memory first (fast), fall back to disk registry */
async function resolveAgent(
  agentName: string,
  runner: string | undefined,
): Promise<{ live: LiveAgent | null; disk: ProcessEntry | null }> {
  const live = getLiveAgent(agentName, runner);
  if (live) return { live, disk: null };

  const disk = await getProcessStatus(agentName, runner);
  return { live: null, disk };
}

// ─── Formatting ───────────────────────────────────────────────────────────────

const OUTPUT_TAIL_CHARS = 2000;

function formatAgent(view: AgentView, action: string, outputTail = OUTPUT_TAIL_CHARS): string {
  const lines: string[] = [];
  const runningFor = view.startedAt ? `${Date.now() - view.startedAt}ms` : '?';

  lines.push(`**Agent:** ${view.agentName}`);
  lines.push(`**Runner:** ${view.runner || 'inconnu'}`);
  lines.push(`**Status:** ${view.status}`);
  lines.push(`**Running:** ${runningFor}`);

  if (view.pid) lines.push(`**PID:** ${view.pid}`);
  if (view.sessionId) lines.push(`**Session:** ${view.sessionId}`);
  if (view.exitCode !== null) lines.push(`**Exit Code:** ${view.exitCode}`);
  if (view.lastOutputAt) {
    lines.push(`**Last Output:** ${new Date(view.lastOutputAt).toISOString()}`);
  }

  const bufLen = view.outputBuffer.length;
  if (bufLen > 0) {
    lines.push(`\n**Output (${bufLen} chars, last ${outputTail}):**`);
    lines.push('```');
    lines.push(view.outputBuffer.slice(-outputTail));
    lines.push('```');
  } else {
    lines.push('\n_(output vide)_');
  }

  return lines.join('\n');
}

// ─── Actions ───────────────────────────────────────────────────────────────────

/** STATUS — zero side-effect read */
async function doStatus(agentName: string, runner: string | undefined): Promise<ControlResult> {
  const { live, disk } = await resolveAgent(agentName, runner);

  if (!live && !disk) {
    return {
      content: [{ type: 'text', text: `Agent "${agentName}" non trouvé.` }],
      isError: true,
    };
  }

  const view: AgentView = live
    ? {
        agentName: live.agentName,
        runner: live.runner,
        status: live.status,
        pid: live.pid,
        sessionId: live.sessionId,
        exitCode: live.exitCode,
        outputBuffer: live.outputBuffer,
        startedAt: live.startedAt,
        lastOutputAt: live.lastOutputAt,
      }
    : {
        agentName: disk!.agentName,
        runner: disk!.runner,
        status: disk!.status as LifecycleStatus,
        pid: disk!.pid,
        sessionId: disk!.id,
        exitCode: disk!.exitCode ?? null,
        outputBuffer: '',         // disk entry has no outputBuffer
        startedAt: disk!.ts,
        lastOutputAt: disk!.lastOutputAt ?? disk!.ts,
      };

  const isZombie = view.status === 'running' && view.pid && !getLiveAgentByPid(view.pid);

  return {
    content: [{ type: 'text', text: formatAgent(view, 'status') }],
    isError: !!isZombie,
  };
}

/** STREAM — read + completeness flag */
async function doStream(
  agentName: string,
  runner: string | undefined,
  sinceTimestamp?: number,
): Promise<ControlResult> {
  const { live, disk } = await resolveAgent(agentName, runner);

  if (!live && !disk) {
    return {
      content: [{ type: 'text', text: `Agent "${agentName}" non trouvé.` }],
      isError: true,
    };
  }

  const isComplete = live
    ? live.status !== 'running'
    : disk!.status !== 'running';

  const output = live ? live.outputBuffer : '';
  if (sinceTimestamp && live) {
    // Ring buffer doesn't support per-chunk timestamps — best-effort: return last 2000
    void sinceTimestamp;
  }

  const view: AgentView = live
    ? {
        agentName: live.agentName,
        runner: live.runner,
        status: live.status,
        pid: live.pid,
        sessionId: live.sessionId,
        exitCode: live.exitCode,
        outputBuffer: output,
        startedAt: live.startedAt,
        lastOutputAt: live.lastOutputAt,
      }
    : {
        agentName: disk!.agentName,
        runner: disk!.runner,
        status: disk!.status as LifecycleStatus,
        pid: disk!.pid,
        sessionId: disk!.id,
        exitCode: disk!.exitCode ?? null,
        outputBuffer: '',
        startedAt: disk!.ts,
        lastOutputAt: disk!.lastOutputAt ?? disk!.ts,
      };

  const lines: string[] = [];
  lines.push(`**Agent:** ${view.agentName}`);
  lines.push(`**Status:** ${view.status}`);
  lines.push(`**isComplete:** ${isComplete}`);
  if (view.pid) lines.push(`**PID:** ${view.pid}`);
  if (view.lastOutputAt) lines.push(`**Last Output At:** ${new Date(view.lastOutputAt).toISOString()}`);
  lines.push(`\n**Output (${output.length} chars):**`);
  lines.push('```');
  lines.push(output.slice(-2000) || '(no output yet)');
  lines.push('```');

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    isError: isComplete && view.status === 'failed',
  };
}

/** KILL — force termination */
async function doKill(agentName: string, runner: string | undefined): Promise<ControlResult> {
  const { live } = await resolveAgent(agentName, runner);

  if (!live || live.status !== 'running') {
    const disk = await getProcessStatus(agentName, runner);
    return {
      content: [
        {
          type: 'text',
          text: disk
            ? `Agent "${agentName}" nest plus en cours (status: ${disk.status}).`
            : `Agent "${agentName}" non trouvé.`,
        },
      ],
      isError: true,
    };
  }

  const pid = live.pid;
  const result = await killAgent(agentName, runner);

  return {
    content: [
      {
        type: 'text',
        text: result.killed
          ? `Agent "${agentName}" tué (PID: ${pid}).`
          : `Échec du kill pour "${agentName}".`,
      },
    ],
    isError: !result.killed,
  };
}

/** WAIT — block until completion, using AbortController when available */
async function doWait(
  agentName: string,
  runner: string | undefined,
  timeoutMs: number,
): Promise<ControlResult> {
  const live = getLiveAgent(agentName, runner);

  // Fast path: agent already done
  if (live) {
    if (live.status !== 'running') {
      return {
        content: [{ type: 'text', text: live.outputBuffer || `Agent terminé (${live.status}).` }],
        isError: live.status === 'failed' || live.status === 'orphaned',
      };
    }

    // Use AbortController if available (instant wake on kill/status change)
    if (live.abortController) {
      try {
        await Promise.race([
          new Promise<void>((_, reject) => {
            live.abortController!.signal.addEventListener('abort', () => reject(new Error('done')));
          }),
          new Promise<void>((r) => setTimeout(r, timeoutMs)),
        ]);
      } catch {
        // Aborted — agent finished
      }
      // Re-read state after wake
      const updated = getLiveAgent(agentName, runner);
      if (updated) {
        return {
          content: [{ type: 'text', text: updated.outputBuffer || `Agent terminé (${updated.status}).` }],
          isError: updated.status === 'failed' || updated.status === 'orphaned',
        };
      }
    }
  } else {
    // Fallback: disk polling
    const disk = await getProcessStatus(agentName, runner);
    if (!disk || disk.status !== 'running') {
      return {
        content: [{ type: 'text', text: disk ? `Agent terminé (${disk.status}).` : `Agent non trouvé.` }],
        isError: true,
      };
    }
  }

  // Polling fallback (disk or no AbortController)
  const start = Date.now();
  const pollInterval = 1000;

  while (Date.now() - start < timeoutMs) {
    await new Promise<void>((r) => setTimeout(r, pollInterval));

    const current = getLiveAgent(agentName, runner);
    if (!current || current.status !== 'running') {
      return {
        content: [{ type: 'text', text: current?.outputBuffer || 'Agent terminé.' }],
        isError: current?.status === 'failed' || current?.status === 'orphaned' || !current,
      };
    }
  }

  return {
    content: [{ type: 'text', text: `Timeout ${timeoutMs}ms atteint. Agent toujours en cours.` }],
    isError: true,
  };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function agentControl(args: AgentControlArgs): Promise<ControlResult> {
  const { agentName, runner, action, timeoutMs, sinceTimestamp } = args;

  switch (action) {
    case 'status': return doStatus(agentName, runner);
    case 'stream': return doStream(agentName, runner, sinceTimestamp);
    case 'kill':   return doKill(agentName, runner);
    case 'wait':   return doWait(agentName, runner, timeoutMs ?? 900000);
  }
}
