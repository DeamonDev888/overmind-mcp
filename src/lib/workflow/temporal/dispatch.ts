import { getTemporalClient, startAgentsWorkflow } from './client.js';
import type { AgentConfig } from './workflows.js';

export interface DispatchResult {
  taskId: string;
  success: boolean;
  result?: string;
  error?: string;
  durationMs?: number;
}

export interface DispatchOptions {
  timeout?: number;
}

export async function dispatchViaTemporal(
  agents: AgentConfig[],
  _opts?: DispatchOptions,
): Promise<DispatchResult[]> {
  const client = getTemporalClient();
  if (!client) {
    throw new Error('Temporal client not initialized. Set OVERMIND_WORKFLOW=temporal');
  }

  const startTime = Date.now();
  const handle = await startAgentsWorkflow(agents);
  const results = (await handle.result()) as {
    success: boolean;
    result?: string;
    error?: string;
  }[];
  const durationMs = Date.now() - startTime;

  return results.map((res, i) => ({
    taskId: `agent-${i}`,
    success: res.success,
    result: res.result,
    error: res.error,
    durationMs,
  }));
}
