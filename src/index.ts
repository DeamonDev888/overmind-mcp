export { runAgent } from './tools/run_agent.js';
export { createServer } from './server.js';
export { AgentManager } from './services/AgentManager.js';
export { getMemoryProvider } from './memory/MemoryFactory.js';
export { updateConfig } from './lib/config.js';
export { ClaudeRunner } from './services/ClaudeRunner.js';

// Swarm Orchestration
export {
  createSwarmOrchestrator,
  type SwarmOrchestrator,
  type SwarmConfig,
  type SwarmTask,
  type SwarmResult,
  type AgentCapability,
} from './lib/orchestration/swarm.js';
