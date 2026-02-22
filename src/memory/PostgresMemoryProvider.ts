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
  private initializedSchemas = new Set<string>();

  constructor() {
    this.pool = getPool();
  }

  private sanitizeIdentifier(name: string): string {
    return name.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
  }

  private getTablePath(tableName: string, agentName?: string): string {
    const schema = agentName ? `agent_${this.sanitizeIdentifier(agentName)}` : 'public';
    return `"${schema}"."${tableName}"`;
  }

  private async ensureSchema(agentName?: string): Promise<string> {
    const schema = agentName ? `agent_${this.sanitizeIdentifier(agentName)}` : 'public';
    if (this.initializedSchemas.has(schema)) return schema;
    
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      
      // Extensions (Shared globally)
      await client.query('CREATE EXTENSION IF NOT EXISTS vector SCHEMA public');
      await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public');
      
      // Create Schema if not public
      if (schema !== 'public') {
        await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      }

      // Agent Runs Table
      await client.query(`
        CREATE TABLE IF NOT EXISTS "${schema}"."agent_runs" (
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

      // Knowledge Chunks Table
      await client.query(`
        CREATE TABLE IF NOT EXISTS "${schema}"."knowledge_chunks" (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          text TEXT NOT NULL,
          embedding public.vector(4096),
          model TEXT,
          created_at BIGINT DEFAULT extract(epoch from now()) * 1000,
          updated_at BIGINT DEFAULT extract(epoch from now()) * 1000
        )
      `);

      // Indexes
      await client.query(`CREATE INDEX IF NOT EXISTS "idx_agent_runs_runner_${schema}" ON "${schema}"."agent_runs"(runner)`);
      if (schema === 'public') {
        await client.query(`CREATE INDEX IF NOT EXISTS "idx_agent_runs_session_${schema}" ON "${schema}"."agent_runs"(session_id)`);
      }

      // GIN index for text search
      await client.query(`CREATE INDEX IF NOT EXISTS "idx_knowledge_text_trgm_${schema}" ON "${schema}"."knowledge_chunks" USING gin (text public.gin_trgm_ops)`);

      await client.query('COMMIT');
      this.initializedSchemas.add(schema);
      return schema;
    } catch (e) {
      await client.query('ROLLBACK');
      console.error(`[PostgresMemory] Schema initialization failed for ${schema}:`, e);
      throw e;
    } finally {
      client.release();
    }
  }

  async storeRun(params: StoreRunParams): Promise<string> {
    const schema = await this.ensureSchema(params.agentName || undefined);
    const id = randomId();
    const table = `"${schema}"."agent_runs"`;
    
    await this.pool.query(
      `INSERT INTO ${table} 
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

  async storeKnowledge(params: { text: string; source?: string; agentName?: string }): Promise<string> {
    const schema = await this.ensureSchema(params.agentName);
    const id = `k_${sha256(params.text)}_${randomId()}`;
    const source = params.agentName ? `agent:${params.agentName}` : (params.source || 'user');
    
    const { embedding, model } = await embedText(params.text);
    const embStr = embedding.length > 0 ? `[${embedding.join(',')}]` : null;
    const table = `"${schema}"."knowledge_chunks"`;

    await this.pool.query(
      `INSERT INTO ${table} (id, source, text, embedding, model) 
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
    const agentSchema = await this.ensureSchema(params.agentName);
    const limit = params.limit || 10;
    const { embedding: queryEmb } = await embedText(params.query);
    
    const merged: SearchResult[] = [];
    const seen = new Set<string>();

    // We can search in BOTH the agent's private schema AND the public schema for global knowledge
    const schemasToSearch = params.agentName ? [agentSchema, 'public'] : ['public'];

    for (const schema of schemasToSearch) {
      if (merged.length >= limit) break;
      const knowledgeTable = `"${schema}"."knowledge_chunks"`;

      // 1. Vector Search
      if (queryEmb.length > 0) {
        const embStr = `[${queryEmb.join(',')}]`;
        const vecRes = await this.pool.query(
          `SELECT id, text, source, created_at, 
                  (1 - (embedding <=> $1)) as score 
           FROM ${knowledgeTable} 
           WHERE embedding IS NOT NULL
           ORDER BY embedding <=> $1 
           LIMIT $2`,
          [embStr, limit - merged.length]
        );

        for (const row of vecRes.rows) {
          if (!seen.has(row.id)) {
            seen.add(row.id);
            merged.push({
              id: row.id,
              text: row.text,
              source: `[${schema}] ${row.source}`,
              score: parseFloat(row.score),
              created_at: parseInt(row.created_at, 10),
              match_type: 'vector'
            });
          }
        }
      }

      // 2. Text Search FALLBACK
      const textLimit = limit - merged.length;
      if (textLimit > 0) {
        const textRes = await this.pool.query(
          `SELECT id, text, source, created_at, similarity(text, $1) as score
           FROM ${knowledgeTable}
           WHERE (text ILIKE $2 OR text % $1)
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
              source: `[${schema}] ${row.source}`,
              score: parseFloat(row.score) || 0.5,
              created_at: parseInt(row.created_at, 10),
              match_type: 'fts'
            });
          }
        }
      }
    }

    // 3. Runs History Search (only in the requested schema)
    if (params.includeRuns) {
      const runsTable = `"${agentSchema}"."agent_runs"`;
      const runRes = await this.pool.query(
        `SELECT id, runner, prompt, result, created_at
         FROM ${runsTable}
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

  async getRecentRuns(params: { runner?: string; limit?: number; agentName?: string }): Promise<AgentRun[]> {
    const schema = await this.ensureSchema(params.agentName);
    const limit = params.limit || 20;
    const table = `"${schema}"."agent_runs"`;

    let query = `SELECT * FROM ${table} ORDER BY created_at DESC LIMIT $1`;
    let values: (string | number)[] = [limit];

    if (params.runner) {
      query = `SELECT * FROM ${table} WHERE runner = $1 ORDER BY created_at DESC LIMIT $2`;
      values = [params.runner, limit];
    }

    const res = await this.pool.query(query, values);
    return res.rows.map((r: AgentRun & { created_at: string; duration_ms: string | null }) => ({
      ...r,
      created_at: parseInt(r.created_at, 10),
      duration_ms: r.duration_ms ? parseInt(r.duration_ms, 10) : null
    }));
  }

  async getStats(agentName?: string): Promise<MemoryStats> {
    const schema = await this.ensureSchema(agentName);
    const totalRunsRes = await this.pool.query(`SELECT COUNT(*) as count FROM "${schema}"."agent_runs"`);
    const totalKnowledgeRes = await this.pool.query(`SELECT COUNT(*) as count FROM "${schema}"."knowledge_chunks"`);
    const byRunnerRes = await this.pool.query(`
      SELECT runner, COUNT(*) as count, SUM(success) as successes 
      FROM "${schema}"."agent_runs" 
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
