import { Client, Connection, WorkflowHandle } from '@temporalio/client';
import { orchestrateAgentsWorkflow } from './workflows.js';
import type { AgentConfig } from './workflows.js';

let _client: Client | null = null;

export function getTemporalClient(): Client | null {
  if (process.env.OVERMIND_WORKFLOW !== 'temporal') {
    return null;
  }

  if (_client) {
    return _client;
  }

  const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
  const connection = Connection.lazy({ address });
  _client = new Client({ connection });
  return _client;
}

export async function startAgentsWorkflow(
  agents: AgentConfig[],
): Promise<WorkflowHandle<typeof orchestrateAgentsWorkflow>> {
  const client = getTemporalClient();
  if (!client) {
    throw new Error('Temporal client not initialized. Set OVERMIND_WORKFLOW=temporal');
  }

  return client.workflow.start(orchestrateAgentsWorkflow, {
    args: [agents],
    taskQueue: 'overmind-agents',
    workflowId: `agents-${Date.now()}`,
  });
}
