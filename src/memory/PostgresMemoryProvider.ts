import { Pool, Client } from 'pg';
import { getPool } from 'overmind-postgres-mcp';
import crypto from 'crypto';
import { embedText } from 'overmind-postgres-mcp/services/embeddings';
import {
  MemoryProvider,
  AgentRun,
  SearchResult,
  MemoryStats,
  StoreRunParams,
  SearchMemoryParams,
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
  private pools = new Map<string, Pool>();
  private initializedDbs = new Set<string>();
  private maintenancePool: Pool;
  private coreDbName = 'overmind_core';

  constructor() {
    // We use the default pool for maintenance operations (creating other DBs)
    this.maintenancePool = getPool();
  }

  private sanitizeIdentifier(name: string): string {
    return name.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
  }

  private getDbName(agentName?: string): string {
    if (!agentName) return this.coreDbName;
    return `agent_${this.sanitizeIdentifier(agentName)}`;
  }

  private async getPoolFor(dbName: string): Promise<Pool> {
    if (this.pools.has(dbName)) return this.pools.get(dbName)!;

    await this.ensureDatabaseExists(dbName);

    // Create a new pool for this specific database
    const poolOptions =
      (this.maintenancePool as unknown as { options: Record<string, unknown> }).options || {};

    // Defensive password retrieval
    let password = process.env.POSTGRES_PASSWORD || '';
    if (typeof poolOptions.password === 'string') {
      password = poolOptions.password;
    } else if (typeof poolOptions.password === 'number') {
      password = String(poolOptions.password);
    }

    const host =
      (poolOptions.host as string | undefined) || process.env.POSTGRES_HOST || '127.0.0.1';
    const port =
      (poolOptions.port as number | undefined) || parseInt(process.env.POSTGRES_PORT || '5432', 10);
    const user =
      (poolOptions.user as string | undefined) || process.env.POSTGRES_USER || 'postgres';
    const max = (poolOptions.max as number | undefined) || 10;
    const idleTimeoutMillis = (poolOptions.idleTimeoutMillis as number | undefined) || 30000;

    console.error(`[PostgresMemory] 📥 Creating connection pool for physical vault: ${dbName}`);
    console.error(`               Host: ${host}`);
    console.error(`               User: ${user}`);

    const newPool = new Pool({
      host,
      port,
      user,
      password,
      database: dbName,
      ssl: poolOptions.ssl as boolean | undefined,
      max,
      idleTimeoutMillis,
    });

    this.pools.set(dbName, newPool);
    return newPool;
  }

  private async ensureDatabaseExists(dbName: string): Promise<void> {
    // We create a one-off connection to 'postgres' to create the new database
    const poolOptions =
      (this.maintenancePool as unknown as { options: Record<string, unknown> }).options || {};

    // Defensive password retrieval
    let password = process.env.POSTGRES_PASSWORD || '';
    if (typeof poolOptions.password === 'string') {
      password = poolOptions.password;
    } else if (typeof poolOptions.password === 'number') {
      password = String(poolOptions.password);
    }

    const maintenanceClientConfig = {
      host: (poolOptions.host as string | undefined) || process.env.POSTGRES_HOST || '127.0.0.1',
      port:
        (poolOptions.port as number | undefined) ||
        parseInt(process.env.POSTGRES_PORT || '5432', 10),
      user: (poolOptions.user as string | undefined) || process.env.POSTGRES_USER || 'postgres',
      password: password,
      database: 'postgres' as const, // ALWAYS connect to postgres for DDL
      ssl: poolOptions.ssl as boolean | undefined,
    };

    console.error(
      `[PostgresMemory] Attempting to ensure DB ${dbName} exists via postgres maintenance DB...`,
    );
    const client = new Client(maintenanceClientConfig);
    try {
      await client.connect();
      const res = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
      if (res.rows.length === 0) {
        console.error(`[PostgresMemory] 🏗️  Creating new physical database: ${dbName}`);
        // Double quote database name to handle special characters or names
        await client.query(`CREATE DATABASE "${dbName}"`);
        console.error(`[PostgresMemory] ✅ Database ${dbName} created.`);
      } else {
        console.error(`[PostgresMemory] ℹ️  Database ${dbName} already exists.`);
      }
    } catch (err: unknown) {
      if (err instanceof Error && (err as { code?: string }).code === '42P04') return; // Duplicate database
      console.error(`[PostgresMemory] ❌ Critical: Failed to create database ${dbName}:`, err);
      throw err;
    } finally {
      await client.end().catch(() => {});
    }
  }

  private async initializeDb(dbName: string, pool: Pool): Promise<void> {
    if (this.initializedDbs.has(dbName)) return;

    const client = await pool.connect();
    try {
      // Extensions (Try to enable outside transaction to avoid aborting the whole thing)
      let hasVector = false;
      try {
        await client.query('CREATE EXTENSION IF NOT EXISTS vector');
        hasVector = true;
      } catch {
        console.warn(`[PostgresMemory] ⚠️ pgvector extension not available in ${dbName}.`);
      }

      try {
        await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
      } catch {
        console.warn(`[PostgresMemory] ⚠️ pg_trgm extension not available in ${dbName}.`);
      }

      await client.query('BEGIN');

      // 1. Agent Runs Table
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

      // 2. Knowledge Chunks Table
      const embeddingType = hasVector ? 'vector(4096)' : 'TEXT';
      await client.query(`
        CREATE TABLE IF NOT EXISTS knowledge_chunks (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          text TEXT NOT NULL,
          embedding ${embeddingType},
          model TEXT,
          created_at BIGINT DEFAULT extract(epoch from now()) * 1000,
          updated_at BIGINT DEFAULT extract(epoch from now()) * 1000
        )
      `);

      // 3. Indexes
      await client.query('CREATE INDEX IF NOT EXISTS idx_agent_runs_runner ON agent_runs(runner)');
      await client.query(
        'CREATE INDEX IF NOT EXISTS idx_agent_runs_session ON agent_runs(session_id)',
      );

      try {
        await client.query(
          'CREATE INDEX IF NOT EXISTS idx_knowledge_text_trgm ON knowledge_chunks USING gin (text gin_trgm_ops)',
        );
      } catch {
        // Silently skip if extension wasn't loaded
      }

      await client.query('COMMIT');
      this.initializedDbs.add(dbName);
      console.error(
        `[PostgresMemory] ✅ Physical vault ${dbName} initialized (Vector: ${hasVector ? 'ON' : 'OFF'}).`,
      );
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`[PostgresMemory] Failed to initialize tables in ${dbName}:`, e);
      throw e;
    } finally {
      client.release();
    }
  }

  async storeRun(params: StoreRunParams): Promise<string> {
    const dbName = this.getDbName(params.agentName || undefined);
    const pool = await this.getPoolFor(dbName);
    await this.initializeDb(dbName, pool);

    const id = randomId();
    await pool.query(
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
        params.sessionId || null,
      ],
    );
    return id;
  }

  async storeKnowledge(params: {
    text: string;
    source?: string;
    agentName?: string;
  }): Promise<string> {
    const dbName = this.getDbName(params.agentName);
    const pool = await this.getPoolFor(dbName);
    await this.initializeDb(dbName, pool);

    const id = `k_${sha256(params.text)}_${randomId()}`;
    // Format source: type|name (ex: agent|sniper, decision|system)
    let source = params.source || 'user';
    if (params.agentName) {
      source = `agent|${params.agentName}`;
    }

    const { embedding, model } = await embedText(params.text);
    const embStr = embedding.length > 0 ? `[${embedding.join(',')}]` : null;

    await pool.query(
      `INSERT INTO knowledge_chunks (id, source, text, embedding, model) 
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET 
         text = EXCLUDED.text, 
         embedding = EXCLUDED.embedding, 
         updated_at = extract(epoch from now()) * 1000`,
      [id, source, params.text, embStr, model],
    );

    return id;
  }

  async searchMemory(params: SearchMemoryParams): Promise<SearchResult[]> {
    const limit = params.limit || 10;
    const { embedding: queryEmb } = await embedText(params.query);
    const merged: SearchResult[] = [];
    const seen = new Set<string>();

    // Search in Agent DB AND Core DB
    const dbsToSearch = [this.getDbName(params.agentName)];
    if (params.agentName) {
      dbsToSearch.push(this.coreDbName);
    }

    for (const dbName of dbsToSearch) {
      if (merged.length >= limit) break;
      const pool = await this.getPoolFor(dbName);
      await this.initializeDb(dbName, pool);

      // 1. Vector Search
      if (queryEmb.length > 0) {
        const embStr = `[${queryEmb.join(',')}]`;
        try {
          const vecRes = await pool.query(
            `SELECT id, text, source, created_at, 
                    (1 - (embedding <=> $1)) as score 
             FROM knowledge_chunks 
             WHERE embedding IS NOT NULL
             ORDER BY embedding <=> $1 
             LIMIT $2`,
            [embStr, limit - merged.length],
          );

          for (const row of vecRes.rows) {
            if (!seen.has(row.id)) {
              seen.add(row.id);
              const [type] = row.source.split('|');
              merged.push({
                id: row.id,
                text: row.text,
                source: row.source,
                score: parseFloat(row.score),
                created_at: parseInt(row.created_at, 10),
                match_type: type === 'pattern' || type === 'decision' ? 'structural' : 'vector',
              });
            }
          }
        } catch {
          throw new Error(
            "❌ CORTEX STRICT RULE: L'extension pgvector est REQUISE pour la recherche. Pas de fallback autorisé.",
          );
        }
      }
    }

    return merged.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async getRecentRuns(params: {
    runner?: string;
    limit?: number;
    agentName?: string;
  }): Promise<AgentRun[]> {
    const dbName = this.getDbName(params.agentName);
    const pool = await this.getPoolFor(dbName);
    await this.initializeDb(dbName, pool);

    const limit = params.limit || 20;
    let query = 'SELECT * FROM agent_runs ORDER BY created_at DESC LIMIT $1';
    let values: (string | number)[] = [limit];

    if (params.runner) {
      query = 'SELECT * FROM agent_runs WHERE runner = $1 ORDER BY created_at DESC LIMIT $2';
      values = [params.runner, limit];
    }

    const res = await pool.query(query, values);
    return res.rows.map((r: AgentRun & { created_at: string; duration_ms: string | null }) => ({
      ...r,
      created_at: parseInt(r.created_at, 10),
      duration_ms: r.duration_ms ? parseInt(r.duration_ms, 10) : null,
    }));
  }

  async getStats(agentName?: string): Promise<MemoryStats> {
    const dbName = this.getDbName(agentName);
    const pool = await this.getPoolFor(dbName);
    await this.initializeDb(dbName, pool);

    const totalRunsRes = await pool.query('SELECT COUNT(*) as count FROM agent_runs');
    const totalKnowledgeRes = await pool.query('SELECT COUNT(*) as count FROM knowledge_chunks');
    const byRunnerRes = await pool.query(`
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
        successes: parseInt(r.successes || '0', 10),
      })),
    };
  }
}
