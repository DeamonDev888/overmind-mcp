export { runAgent } from './tools/run_agent.js';
export { createServer } from './server.js';
export { AgentManager } from './services/AgentManager.js';
export { getMemoryProvider } from './memory/MemoryFactory.js';
export { updateConfig } from './lib/config.js';
export { ClaudeRunner } from './services/ClaudeRunner.js';

// Orchestration (v3.0 — swarm.ts replaced by KanbanAdapter)
export { dispatchAgents } from './lib/orchestration/dispatcher.js';
export type {
  AgentSpec,
  DispatchOptions,
  AgentDispatchResult,
} from './lib/orchestration/dispatcher.js';
export { KanbanAdapter } from './services/KanbanAdapter.js';
export type { CreateTaskOptions, TaskStatus, TaskResult } from './services/KanbanAdapter.js';
