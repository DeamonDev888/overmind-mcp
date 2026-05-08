import { proxyActivities } from '@temporalio/workflow';
import type { RunAgentActivityInput } from './activities.js';

const activities = proxyActivities<{
  runAgentActivity: (
    input: RunAgentActivityInput,
  ) => Promise<{ success: boolean; result?: string; error?: string }>;
}>({
  startToCloseTimeout: '15 minutes',
  retry: {
    maximumAttempts: 2,
  },
});

export interface AgentConfig {
  runner: string;
  prompt: string;
  agentName?: string;
  model?: string;
  path?: string;
}

export async function orchestrateAgentsWorkflow(agents: AgentConfig[]): Promise<unknown[]> {
  return Promise.all(
    agents.map((agent) =>
      activities.runAgentActivity({
        runner: agent.runner,
        prompt: agent.prompt,
        agentName: agent.agentName,
        model: agent.model,
        path: agent.path,
      }),
    ),
  );
}
