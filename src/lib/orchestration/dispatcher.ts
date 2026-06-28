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

/**
 * Main dispatcher entry point (v3.0 — Refactored).
 *
 * Routing logic:
 *   - ALL agents are Hermes + waitAll=true → dispatch via Kanban (durable, SQLite-backed)
 *   - Otherwise → dispatch via runAgentsLocally (in-process, spawn direct)
 *
 * Kanban dispatch is only used for Hermes-only groups because:
 *   1. Kanban provides durability (survives crashes)
 *   2. Kanban provides circuit breaker (auto-reclaim, auto-retry)
 *   3. Kanban provides dependency graph (parent→child)
 *   4. Non-Hermes runners (claude, kilo, etc.) can't be spawned by the Kanban dispatcher
 */
export async function dispatchAgents(agents: AgentSpec[], opts: DispatchOptions) {
  const allHermes = agents.length > 1 && agents.every(a => a.runner === 'hermes');

  // ─── All-Hermes parallel dispatch → Kanban (durable) ──────────────────────
  if (allHermes && opts.waitAll) {
    try {
      return await dispatchViaKanban(agents, opts);
    } catch (e) {
      // Fallback to in-process dispatch if kanban fails
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[dispatchAgents] Kanban dispatch failed (${msg}) — falling back to in-process.`);
    }
  }

  // ─── Default: in-process dispatch ─────────────────────────────────────────
  return runAgentsLocally(agents, opts);
}

/**
 * Dispatch a group of Hermes agents via Kanban tasks.
 *
 * Each agent becomes a Kanban task assigned to its profile. The Kanban dispatcher
 * spawns each as a separate OS process with circuit breaker, retry, and durability.
 *
 * YOLO: auto-reclaim on stale, auto-unblock on block, no human intervention.
 */
async function dispatchViaKanban(
  agents: AgentSpec[],
  opts: DispatchOptions,
): Promise<{ content: [{ type: 'text'; text: string }]; isError: boolean }> {
  const { KanbanAdapter } = await import('../../services/KanbanAdapter.js');
  const kanban = new KanbanAdapter();

  const startTime = Date.now();

  // ─── Ensure kanban is initialized ─────────────────────────────────────────
  try {
    await kanban.init();
  } catch {
    // init is idempotent — ignore errors
  }

  // ─── Create parallel tasks ────────────────────────────────────────────────
  const taskDefs = agents.map((agent, i) => ({
    title: agent.taskId || agent.agentName || `task_${i + 1}`,
    assignee: agent.agentName || 'default',
    body: agent.prompt,
    idempotencyKey: agent.taskId, // dedup if taskId is provided
  }));

  const taskIds = await kanban.createParallelTasks(taskDefs);

  // ─── Wait for all tasks to complete ───────────────────────────────────────
  const timeoutMs = 600000; // 10min per task
  const results = await Promise.all(
    taskIds.map(async (taskId, i) => {
      const label = agents[i].taskId || agents[i].agentName || `task_${i + 1}`;
      const taskStart = Date.now();

      try {
        const result = await kanban.wait(taskId, timeoutMs);
        const elapsed = ((Date.now() - taskStart) / 1000).toFixed(1);

        return {
          label,
          runner: 'hermes' as const,
          agentName: agents[i].agentName,
          status: (result.status === 'done' ? 'success' : 'error') as 'success' | 'error',
          elapsed: `${elapsed}s`,
          result: result.summary || result.error || '(no output)',
        };
      } catch (e) {
        const elapsed = ((Date.now() - taskStart) / 1000).toFixed(1);
        return {
          label,
          runner: 'hermes' as const,
          agentName: agents[i].agentName,
          status: 'error' as const,
          elapsed: `${elapsed}s`,
          result: e instanceof Error ? e.message : String(e),
        };
      }
    })
  );

  // ─── Build summary ────────────────────────────────────────────────────────
  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const successCount = results.filter(r => r.status === 'success').length;
  const errorCount = results.filter(r => r.status === 'error').length;

  const summary = [
    `⚡ dispatch_via_kanban — ${results.length} agent(s) | ✅ ${successCount} succès | ❌ ${errorCount} erreurs | 🕐 ${totalElapsed}s total`,
    '',
    ...results.map(r => {
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
