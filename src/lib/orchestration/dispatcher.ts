import { z } from 'zod';
import { runAgent, runAgentSchema } from '../../tools/run_agent.js';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type AgentSpec = z.infer<typeof runAgentSchema> & {
  taskId?: string;
};

export interface DispatchOptions {
  waitAll: boolean;
}

// ─── Result type (opaque, avoids tight coupling to runner internals) ────────────

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
          result: text.slice(0, 2000),
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

  let results: AgentDispatchResult[] = [];

  if (waitAll) {
    const settledResults = await Promise.allSettled(promises);
    results = settledResults.map((s, i) => {
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
  } else {
    const firstResult = await Promise.race(promises);
    for (let i = 0; i < controllers.length; i++) {
      if (!settled[i]) {
        controllers[i].abort();
      }
    }
    results = [firstResult];
  }

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
}

// ─── Dispatcher ────────────────────────────────────────────────────────────────

export async function dispatchAgents(agents: AgentSpec[], opts: DispatchOptions) {
  // Temporal workflow
  if (process.env.OVERMIND_WORKFLOW === 'temporal') {
    try {
      const m = await import('../workflow/temporal/dispatch.js');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await m.dispatchViaTemporal(agents, opts as any);
    } catch (err) {
      console.warn(
        '[dispatcher] Temporal dispatch failed, falling back to local:',
        err instanceof Error ? err.message : String(err),
      );
      return runAgentsLocally(agents, opts);
    }
  }

  // RabbitMQ broker
  if (process.env.OVERMIND_BROKER === 'rabbitmq') {
    try {
      const m = await import('../broker/rabbitmqDispatch.js');
      const rabbitResults = await m.dispatchViaRabbitMQ(agents, opts);
      // Adapt RabbitMQ result format to AgentDispatchResult[]
      const adapted: AgentDispatchResult[] = rabbitResults.map((r) => ({
        label: r.taskId,
        runner:
          agents.find((a) => (a.taskId || a.agentName || a.runner) === r.taskId)?.runner ??
          'unknown',
        agentName: agents.find((a) => (a.taskId || a.agentName || a.runner) === r.taskId)
          ?.agentName,
        status: r.success ? 'success' : 'error',
        elapsed: `${(r.durationMs / 1000).toFixed(1)}s`,
        result:
          r.error ??
          (typeof r.result === 'string'
            ? r.result.slice(0, 2000)
            : JSON.stringify(r.result).slice(0, 2000)),
      }));
      // Build summary (same format as runAgentsLocally)
      const successCount = adapted.filter((r) => r.status === 'success').length;
      const errorCount = adapted.filter((r) => r.status === 'error').length;
      const totalElapsed = (
        (Date.now() - (Date.now() - Math.max(...rabbitResults.map((r) => r.durationMs)))) /
        1000
      ).toFixed(1);
      const summary = [
        `⚡ run_agents_parallel — ${adapted.length} agent(s) | ✅ ${successCount} succès | ❌ ${errorCount} erreurs | 🕐 ${totalElapsed}s total`,
        '',
        ...adapted.map((r) => {
          const icon = r.status === 'success' ? '✅' : '❌';
          const header = `${icon} [${r.label}] ${r.runner}${r.agentName ? `/${r.agentName}` : ''} (${r.elapsed})`;
          return `${header}\n${r.result}`;
        }),
      ].join('\n---\n');
      return {
        content: [{ type: 'text' as const, text: summary }],
        isError: errorCount === adapted.length,
      };
    } catch (err) {
      console.warn(
        '[dispatcher] RabbitMQ dispatch failed, falling back to local:',
        err instanceof Error ? err.message : String(err),
      );
      return runAgentsLocally(agents, opts);
    }
  }

  // Default: local execution
  return runAgentsLocally(agents, opts);
}
