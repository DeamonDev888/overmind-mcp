export { runAgent } from './tools/run_agent.js';
export { createServer } from './server.js';
export { AgentManager } from './services/AgentManager.js';
export { PromptManager } from './services/PromptManager.js';
export { ClaudeRunner } from './services/ClaudeRunner.js';
export { getMemoryProvider } from './memory/MemoryFactory.js';
export { updateConfig } from './lib/config.js';

// Swarm Orchestration
export {
  createSwarmOrchestrator,
  type SwarmOrchestrator,
  type SwarmConfig,
  type SwarmTask,
  type SwarmResult,
  type AgentCapability,
} from './lib/orchestration/swarm.js';

// Temporal Workflows
export {
  orchestrateAgentsWorkflow,
  longRunningWorkflow,
  type AgentConfig,
  type LongRunningWorkflowInput,
  type LongRunningWorkflowState,
} from './lib/workflow/temporal/workflows.js';

export {
  getTemporalClient,
  startAgentsWorkflow,
  startLongRunningWorkflow,
  getLongRunningWorkflowHandle,
} from './lib/workflow/temporal/client.js';
