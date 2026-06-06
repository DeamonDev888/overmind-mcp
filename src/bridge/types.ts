/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║   OVERMIND BRIDGE — Types & Interfaces                              ║
 * ║   Contrats partagés pour le transport JSON-RPC 2.0                  ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

// ─── JSON-RPC 2.0 ─────────────────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params: Record<string, unknown>;
}

export interface McpResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: {
    content?: Array<McpContent>;
    isError?: boolean;
    sessionId?: string;
    [key: string]: unknown;
  };
  error?: McpError;
}

export interface McpContent {
  type: string;
  text: string;
}

export interface McpError {
  code: number;
  message: string;
  data?: unknown;
}

// ─── Agent ─────────────────────────────────────────────────────────────────

export type RunnerType =
  | 'claude'
  | 'gemini'
  | 'antigravity'
  | 'kilo'
  | 'qwencli'
  | 'openclaw'
  | 'cline'
  | 'opencode'
  | 'hermes';

export interface RunAgentOptions {
  runner: RunnerType;
  prompt: string;
  agentName: string;
  sessionId?: string;
  autoResume?: boolean;
  silent?: boolean;
  path?: string;
  model?: string;
  mode?: string;
  config?: string;
}

export interface AgentResult {
  content: Array<McpContent>;
  isError: boolean;
  sessionId?: string;
}

// ─── Agent Control ─────────────────────────────────────────────────────────

export type AgentAction = 'status' | 'stream' | 'kill' | 'wait';

export interface AgentControlOptions {
  agentName: string;
  action: AgentAction;
  runner?: RunnerType;
  sinceTimestamp?: number;
  timeoutMs?: number;
}

// ─── Memory ────────────────────────────────────────────────────────────────

export interface MemorySearchOptions {
  query: string;
  agent_name?: string;
  limit?: number;
  include_runs?: boolean;
}

export interface MemoryStoreOptions {
  text: string;
  agent_name?: string;
  source?: 'user' | 'agent' | 'pattern' | 'error' | 'decision';
}

export interface MemoryRunsOptions {
  runner?: string;
  limit?: number;
  stats?: boolean;
  agent_name?: string;
}

// ─── Agent Configs ─────────────────────────────────────────────────────────

export interface UpdateAgentConfigOptions {
  name: string;
  model?: string;
  mcpServers?: string[];
  env?: Record<string, string>;
  runner?: RunnerType;
  mode?: 'code' | 'architect' | 'ask' | 'debug' | 'orchestrator' | 'plan' | 'act';
  cliPath?: string;
  file?: 'prompt.md' | 'settings.json' | '.mcp.json' | 'skill.md';
  content?: string;
}

// ─── Prompt Management ─────────────────────────────────────────────────────

export interface CreatePromptOptions {
  name: string;
  content: string;
}

export interface EditPromptOptions {
  name: string;
  search: string;
  replace: string;
}

// ─── Bridge Config ─────────────────────────────────────────────────────────

export interface BridgeConfig {
  /** URL du serveur MCP Overmind (default: http://localhost:3099/mcp) */
  mcpUrl: string;
  /** Timeout par défaut en ms pour les appels MCP (default: 60_000) */
  defaultTimeoutMs: number;
  /** Timeout pour run_agent en ms (default: 3_600_000 = 1h) */
  agentTimeoutMs: number;
  /** Nombre max de retry sur erreurs transitoires (default: 2) */
  maxRetries: number;
  /** Délai entre les retry en ms (default: 2_000) */
  retryDelayMs: number;
}

export const DEFAULT_BRIDGE_CONFIG: BridgeConfig = {
  mcpUrl: 'http://localhost:3099/mcp',
  defaultTimeoutMs: 60_000,
  agentTimeoutMs: 3_600_000, // 1h
  maxRetries: 2,
  retryDelayMs: 2_000,
};

// ─── Circuit Breaker ───────────────────────────────────────────────────────

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  /** Nombre d'échecs avant ouverture (default: 5) */
  failureThreshold: number;
  /** Temps en ms avant tentative half-open (default: 30_000) */
  resetTimeoutMs: number;
  /** Nombre de succès consécutifs pour fermer (default: 3) */
  successThreshold: number;
}

export const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  successThreshold: 3,
};

// ─── Session ───────────────────────────────────────────────────────────────

export interface SessionState {
  currentSessionId: string | undefined;
  lastActivityAt: number;
  messageCount: number;
}

// ─── Health ────────────────────────────────────────────────────────────────

export interface HealthStatus {
  status: 'online' | 'degraded' | 'offline';
  mcpUrl: string;
  circuitState: CircuitState;
  session?: SessionState;
  latencyMs?: number;
  checkedAt: number;
}
