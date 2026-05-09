import { proxyActivities, defineSignal, defineQuery, setHandler, condition } from '@temporalio/workflow';
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

// ─── LONG-RUNNING WORKFLOWS (OSINT, analyses longues) ─────────────────────────────────────

export interface TaskBatch {
  id: string;
  tasks: AgentConfig[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: number;
  completedAt?: number;
  results?: unknown[];
  errors?: string[];
}

export interface LongRunningWorkflowInput {
  batches: TaskBatch[];
  maxParallelBatches?: number;
  batchTimeout?: string; // e.g., '1 hour', '24 hours'
}

export interface LongRunningWorkflowState {
  totalBatches: number;
  completedBatches: number;
  failedBatches: number;
  currentBatch?: string;
  errors: string[];
}

// Signals pour contrôle externe
const cancelSignal = defineSignal('cancel');
const pauseSignal = defineSignal('pause');
const resumeSignal = defineSignal('resume');

// Query pour état en temps réel
const stateQuery = defineQuery<LongRunningWorkflowState>('state');

export async function longRunningWorkflow(input: LongRunningWorkflowInput): Promise<void> {
  const { batches } = input;
  const state: LongRunningWorkflowState = {
    totalBatches: batches.length,
    completedBatches: 0,
    failedBatches: 0,
    errors: [],
  };

  let cancelled = false;
  let paused = false;

  // Gestionnaires de signaux
  setHandler(cancelSignal, () => {
    cancelled = true;
  });

  setHandler(pauseSignal, () => {
    paused = true;
  });

  setHandler(resumeSignal, () => {
    paused = false;
  });

  setHandler(stateQuery, () => state);

  // Exécuter les batches avec parallélisme limitée
  for (let i = 0; i < batches.length; i++) {
    if (cancelled) {
      state.errors.push('Workflow annulé par signal externe');
      break;
    }

    // Attendre si paused
    await condition(() => !paused);

    const batch = batches[i];
    state.currentBatch = batch.id;
    batch.status = 'running';
    batch.startedAt = Date.now();

    try {
      const results = await Promise.all(
        batch.tasks.map((task) =>
          activities.runAgentActivity({
            runner: task.runner,
            prompt: task.prompt,
            agentName: task.agentName,
            model: task.model,
            path: task.path,
          }),
        ),
      );

      batch.status = 'completed';
      batch.completedAt = Date.now();
      batch.results = results;
      state.completedBatches++;
    } catch (error) {
      batch.status = 'failed';
      batch.completedAt = Date.now();
      batch.errors = [error instanceof Error ? error.message : String(error)];
      state.failedBatches++;
      state.errors.push(batch.errors[0]);
    }
  }

  state.currentBatch = undefined;
}
