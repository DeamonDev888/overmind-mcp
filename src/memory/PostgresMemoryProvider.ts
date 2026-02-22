import { Pool } from 'pg';
import { getPool } from 'postgresql-mcp-server';
import crypto from 'crypto';
import { embedText } from './embeddings.js';
import {
  MemoryProvider,
  AgentRun,
  SearchResult,
  MemoryStats,
  StoreRunParams,
  SearchMemoryParams
} from './types.js';

// ── Internal helpers ─────────────────────────────────────────────────────────

function randomId(): string {
  return crypto.randomBytes(8).toString('hex');
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

// ── Provider Implementation ──────────────────────────────────────────────────

export class PostgresMemoryProvider implements MemoryProvider {
  private pool: Pool;
  private initialized = false;

  constructor() {
    this.pool = getPool();
  }

  private async ensureSchema(): Promise<void> {
    if (this.initialized) return;
    
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      
      // Extensions
      await client.query('CREATE EXTENSION IF NOT EXISTS vector');
      await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
      
      // Agent Runs
      await client.query(`
        CREATE TABLE IF NOT EXISTS agent_runs (
          id TEXT PRIMARY KEY,
          runner TEXT NOT NULL,
          agent_name TEXT,
          prompt TEXT NOT NULL,
          result TEXT,
          error TEXT,
          duration_ms INTEGER,
          success INTEGER DEFAULT 0,
          session_id TEXT,
          created_at BIGINT DEFAULT extract(epoch from now()) * 1000
        )
      `);

      // Knowledge Chunks
      await client.query(`
        CREATE TABLE IF NOT EXISTS knowledge_chunks (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          text TEXT NOT NULL,
          embedding vector(4096),
          model TEXT,
          created_at BIGINT DEFAULT extract(epoch from now()) * 1000,
          updated_at BIGINT DEFAULT extract(epoch from now()) * 1000
        )
      `);

      // Indexes
      await client.query('CREATE INDEX IF NOT EXISTS idx_agent_runs_runner ON agent_runs(runner)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_agent_runs_session ON agent_runs(session_id)');
      
      // HNSW Index for 4096D vectors (Cosine similarity)
      // Note: pgvector HNSW limits dimensions to 2000 by default. 
      // We are using 4096D (Qwen) so we rely on exact nearest neighbor search (no index) which is perfectly fast for moderate scales.

      // GIN index for text search (trigram & fts fallback)
      await client.query('CREATE INDEX IF NOT EXISTS idx_knowledge_text_trgm ON knowledge_chunks USING gin (text gin_trgm_ops)');

      await client.query('COMMIT');
      this.initialized = true;
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('[PostgresMemory] Schema initialization failed:', e);
      throw e;
    } finally {
      client.release();
    }
  }

  async storeRun(params: StoreRunParams): Promise<string> {
    await this.ensureSchema();
    const id = randomId();
    await this.pool.query(
      `INSERT INTO agent_runs 
        (id, runner, agent_name, prompt, result, error, duration_ms, success, session_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id, 
        params.runner, 
        params.agentName || null, 
        params.prompt.slice(0, 4096), 
        params.result?.slice(0, 8192) || null, 
        params.error || null, 
        params.durationMs || null, 
        params.success ? 1 : 0, 
        params.sessionId || null
      ]
    );
    return id;
  }

  async storeKnowledge(params: { text: string; source?: string }): Promise<string> {
    await this.ensureSchema();
    const id = `k_${sha256(params.text)}_${randomId()}`;
    const source = params.source || 'user';
    
    const { embedding, model } = await embedText(params.text);
    
    // Convert array to pgvector string format: [1,2,3]
    const embStr = embedding.length > 0 ? `[${embedding.join(',')}]` : null;

    await this.pool.query(
      `INSERT INTO knowledge_chunks (id, source, text, embedding, model) 
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET 
         text = EXCLUDED.text, 
         embedding = EXCLUDED.embedding, 
         updated_at = extract(epoch from now()) * 1000`,
      [id, source, params.text, embStr, model]
    );

    return id;
  }

  async searchMemory(params: SearchMemoryParams): Promise<SearchResult[]> {
    await this.ensureSchema();
    const limit = params.limit || 10;
    const { embedding: queryEmb } = await embedText(params.query);
    
    const merged: SearchResult[] = [];
    const seen = new Set<string>();

    // 1. Vector Search
    if (queryEmb.length > 0) {
      const embStr = `[${queryEmb.join(',')}]`;
      const vecRes = await this.pool.query(
        `SELECT id, text, source, created_at, 
                (1 - (embedding <=> $1)) as score 
         FROM knowledge_chunks 
         WHERE embedding IS NOT NULL
         ORDER BY embedding <=> $1 
         LIMIT $2`,
        [embStr, limit]
      );

      for (const row of vecRes.rows) {
        seen.add(row.id);
        merged.push({
          id: row.id,
          text: row.text,
          source: row.source,
          score: parseFloat(row.score),
          created_at: parseInt(row.created_at, 10),
          match_type: 'vector'
        });
      }
    }

    // 2. Text Search (Trigram / ILIKE fallback for when no embedding is available or as hybrid)
    const textLimit = limit - merged.length;
    if (textLimit > 0) {
      const textRes = await this.pool.query(
        `SELECT id, text, source, created_at, similarity(text, $1) as score
         FROM knowledge_chunks
         WHERE text ILIKE $2 OR text % $1
         ORDER BY score DESC
         LIMIT $3`,
        [params.query, `%${params.query}%`, textLimit]
      );

      for (const row of textRes.rows) {
        if (!seen.has(row.id)) {
          seen.add(row.id);
          merged.push({
            id: row.id,
            text: row.text,
            source: row.source,
            score: parseFloat(row.score) || 0.5,
            created_at: parseInt(row.created_at, 10),
            match_type: 'fts'
          });
        }
      }
    }

    // 3. Runs History Search
    if (params.includeRuns) {
      const runRes = await this.pool.query(
        `SELECT id, runner, prompt, result, created_at
         FROM agent_runs
         WHERE prompt ILIKE $1 OR result ILIKE $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [`%${params.query}%`, Math.ceil(limit / 2)]
      );

      for (const row of runRes.rows) {
        if (!seen.has(row.id)) {
          seen.add(row.id);
          merged.push({
            id: row.id,
            text: `[${row.runner}] ${row.prompt.slice(0, 200)}`,
            source: 'agent_run',
            score: 0.5,
            created_at: parseInt(row.created_at, 10),
            match_type: 'fts'
          });
        }
      }
    }

    return merged.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async getRecentRuns(params: { runner?: string; limit?: number }): Promise<AgentRun[]> {
    await this.ensureSchema();
    const limit = params.limit || 20;
    let query = 'SELECT * FROM agent_runs ORDER BY created_at DESC LIMIT $1';
    let values: (string | number)[] = [limit];

    if (params.runner) {
      query = 'SELECT * FROM agent_runs WHERE runner = $1 ORDER BY created_at DESC LIMIT $2';
      values = [params.runner, limit];
    }

    const res = await this.pool.query(query, values);
    return res.rows.map((r: AgentRun & { created_at: string; duration_ms: string | null }) => ({
      ...r,
      created_at: parseInt(r.created_at, 10),
      duration_ms: r.duration_ms ? parseInt(r.duration_ms, 10) : null
    }));
  }

  async getStats(): Promise<MemoryStats> {
    await this.ensureSchema();
    const totalRunsRes = await this.pool.query('SELECT COUNT(*) as count FROM agent_runs');
    const totalKnowledgeRes = await this.pool.query('SELECT COUNT(*) as count FROM knowledge_chunks');
    const byRunnerRes = await this.pool.query(`
      SELECT runner, COUNT(*) as count, SUM(success) as successes 
      FROM agent_runs 
      GROUP BY runner
    `);

    return {
      totalRuns: parseInt(totalRunsRes.rows[0].count, 10),
      totalKnowledge: parseInt(totalKnowledgeRes.rows[0].count, 10),
      byRunner: byRunnerRes.rows.map((r: { runner: string; count: string; successes: string }) => ({
        runner: r.runner,
        count: parseInt(r.count, 10),
        successes: parseInt(r.successes || '0', 10)
      }))
    };
  }
}
