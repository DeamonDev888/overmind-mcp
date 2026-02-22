export interface AgentRun {
  id: string;
  runner: string;
  agent_name: string | null;
  prompt: string;
  result: string | null;
  error: string | null;
  duration_ms: number | null;
  success: number;
  session_id: string | null;
  created_at: number;
}

export interface KnowledgeChunk {
  id: string;
  source: string;
  text: string;
  embedding: string | null;
  model: string | null;
  created_at: number;
  updated_at: number;
}

export interface SearchResult {
  id: string;
  text: string;
  source: string;
  score: number;
  created_at: number;
  match_type: 'vector' | 'fts' | 'combined';
}

export interface MemoryStats {
  totalRuns: number;
  totalKnowledge: number;
  byRunner: Array<{
    runner: string;
    count: number;
    successes: number;
  }>;
}

export interface StoreRunParams {
  runner: string;
  agentName?: string;
  prompt: string;
  result?: string;
  error?: string;
  durationMs?: number;
  success: boolean;
  sessionId?: string;
}

export interface SearchMemoryParams {
  query: string;
  limit?: number;
  includeRuns?: boolean;
  agentName?: string;
}

export interface MemoryProvider {
  storeRun(params: StoreRunParams): Promise<string> | string;
  storeKnowledge(params: { text: string; source?: string; agentName?: string }): Promise<string>;
  searchMemory(params: SearchMemoryParams): Promise<SearchResult[]>;
  getRecentRuns(params: { runner?: string; limit?: number; agentName?: string }): Promise<AgentRun[]>;
  getStats(agentName?: string): Promise<MemoryStats> | MemoryStats;
}
