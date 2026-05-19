import { z } from 'zod';
import { runAgent, runAgentSchema, type RunAgentInternalArgs } from '../../tools/run_agent.js';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type AgentSpec = z.infer<typeof runAgentSchema> & {
  taskId?: string;
};

// Reexport pour les consommateurs qui propagent un AbortSignal
export type { RunAgentInternalArgs };

export interface DispatchOptions {
  waitAll: boolean;
}

// ─── Result type ────────────────────────────────────────────────────────────────

export interface AgentDispatchResult {
  label: string;
  runner: string;
  agentName?: string;
  status: 'success' | 'error';
  elapsed: string;
  result: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractResultText(result: any): string {
  if (Array.isArray(result?.content)) {
    return result.content
      .filter((c: { type: string }) => c.type === 'text')
      .map((c: { text: string }) => c.text)
      .join('\n');
  }
  return String(result ?? '');
}

// ─── Core logic ────────────────────────────────────────────────────────────────

export async function runAgentsLocally(
  agents: AgentSpec[],
  opts: DispatchOptions,
): Promise<{ content: [{ type: 'text'; text: string }]; isError: boolean }> {
  const { waitAll } = opts;
  const startTime = Date.now();

  const controllers = agents.map(() => new AbortController());
  const settled = new Array(agents.length).fill(false);
  const resolved = false;

  const promises = agents.map(
    async (agentArgs: AgentSpec, index: number): Promise<AgentDispatchResult> => {
      const label = agentArgs.taskId || agentArgs.agentName || `task_${index + 1}`;
      const taskStart = Date.now();

      try {
        const result = await runAgent({ ...agentArgs, signal: controllers[index].signal });
        settled[index] = true;
        const elapsed = ((Date.now() - taskStart) / 1000).toFixed(1);
        const text = extractResultText(result);

        return {
          label,
          runner: agentArgs.runner,
          agentName: agentArgs.agentName,
          status: result?.isError ? 'error' : 'success',
          elapsed: `${elapsed}s`,
          result: text,
        };
      } catch (err: unknown) {
        settled[index] = true;
        const elapsed = ((Date.now() - taskStart) / 1000).toFixed(1);
        const msg = err instanceof Error ? err.message : String(err);
        return {
          label,
          runner: agentArgs.runner,
          agentName: agentArgs.agentName,
          status: 'error' as const,
          elapsed: `${elapsed}s`,
          result: msg,
        };
      }
    },
  );

  if (waitAll) {
    const settledResults = await Promise.allSettled(promises);
    const results: AgentDispatchResult[] = settledResults.map((s, i) => {
      const label = agents[i].taskId || agents[i].agentName || `task_${i + 1}`;
      if (s.status === 'fulfilled') return s.value;
      return {
        label,
        runner: agents[i].runner,
        agentName: agents[i].agentName,
        status: 'error' as const,
        elapsed: '?',
        result: s.reason instanceof Error ? s.reason.message : String(s.reason),
      };
    });

    const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const successCount = results.filter((r) => r.status === 'success').length;
    const errorCount = results.filter((r) => r.status === 'error').length;

    const summary = [
      `⚡ run_agents_parallel — ${results.length} agent(s) | ✅ ${successCount} succès | ❌ ${errorCount} erreurs | 🕐 ${totalElapsed}s total`,
      '',
      ...results.map((r) => {
        const icon = r.status === 'success' ? '✅' : '❌';
        const header = `${icon} [${r.label}] ${r.runner}${r.agentName ? `/${r.agentName}` : ''} (${r.elapsed})`;
        return `${header}\n${r.result}`;
      }),
    ].join('\n---\n');

    return {
      content: [{ type: 'text' as const, text: summary }],
      isError: errorCount === results.length,
    };
  } else {
    // Race mode: get first result, abort others, AND catch unhandled rejections
    const firstResult = await Promise.race(promises);

    // Abort all unsettled agents
    for (let i = 0; i < controllers.length; i++) {
      if (!settled[i]) {
        controllers[i].abort();
      }
    }

    // Catch any remaining promises to prevent unhandled rejections
    // (they may reject after being aborted)
    for (let i = 0; i < promises.length; i++) {
      if (!settled[i]) {
        promises[i].catch(() => {}); // Silently absorb abort rejections
      }
    }

    const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const singleResult = [firstResult];
    const successCount = singleResult.filter((r) => r.status === 'success').length;
    const errorCount = singleResult.filter((r) => r.status === 'error').length;

    const summary = [
      `⚡ run_agents_parallel — ${singleResult.length} agent(s) | ✅ ${successCount} succès | ❌ ${errorCount} erreurs | 🕐 ${totalElapsed}s total`,
      '',
      ...singleResult.map((r) => {
        const icon = r.status === 'success' ? '✅' : '❌';
        const header = `${icon} [${r.label}] ${r.runner}${r.agentName ? `/${r.agentName}` : ''} (${r.elapsed})`;
        return `${header}\n${r.result}`;
      }),
    ].join('\n---\n');

    return {
      content: [{ type: 'text' as const, text: summary }],
      isError: errorCount === singleResult.length,
    };
  }
}

// ─── Dispatcher ────────────────────────────────────────────────────────────────

export async function dispatchAgents(agents: AgentSpec[], opts: DispatchOptions) {
  return runAgentsLocally(agents, opts);
}
