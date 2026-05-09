import { Client, Connection, WorkflowHandle } from '@temporalio/client';
import { orchestrateAgentsWorkflow, longRunningWorkflow } from './workflows.js';
import type { AgentConfig, LongRunningWorkflowInput } from './workflows.js';

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
    workflowRunTimeout: '30 minutes',
  });
}

export async function startLongRunningWorkflow(
  input: LongRunningWorkflowInput,
): Promise<WorkflowHandle<typeof longRunningWorkflow>> {
  const client = getTemporalClient();
  if (!client) {
    throw new Error('Temporal client not initialized. Set OVERMIND_WORKFLOW=temporal');
  }

  const workflowId = `long-running-${Date.now()}`;

  return client.workflow.start(longRunningWorkflow, {
    args: [input],
    taskQueue: 'overmind-agents',
    workflowId,
    workflowRunTimeout: '7 days', // Workflows pouvant durer jusqu'à 7 jours
  });
}

export async function getLongRunningWorkflowHandle(
  workflowId: string,
): Promise<WorkflowHandle<typeof longRunningWorkflow>> {
  const client = getTemporalClient();
  if (!client) {
    throw new Error('Temporal client not initialized. Set OVERMIND_WORKFLOW=temporal');
  }

  return client.workflow.getHandle(workflowId);
}
