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
import { rootLogger } from '../lib/logger.js';

const logger = rootLogger.child({ module: 'PostgresMemory' });

// ── Internal helpers ─────────────────────────────────────────────────────────

function randomId(): string {
  return crypto.randomBytes(8).toString('hex');
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

// ── Alert System ─────────────────────────────────────────────────────────────

interface AlertCallback {
  (message: string, error?: Error): void;
}

let alertCallbacks: AlertCallback[] = [];
let lastDbError: string | null = null;
let lastDbErrorTime: number = 0;

export function registerMemoryAlertCallback(callback: AlertCallback): void {
  alertCallbacks.push(callback);
  logger.info('Memory alert callback registered');
}

export function unregisterMemoryAlertCallback(callback: AlertCallback): void {
  alertCallbacks = alertCallbacks.filter((cb) => cb !== callback);
}

function triggerMemoryAlert(message: string, error?: Error): void {
  const now = Date.now();
  const errorMsg = error?.message || message;

  // Debounce: don't spam alerts for the same error within 60 seconds
  if (errorMsg === lastDbError && now - lastDbErrorTime < 60000) {
    return;
  }

  lastDbError = errorMsg;
  lastDbErrorTime = now;

  // Log locally first
  logger.error({ error: errorMsg, stack: error?.stack }, message);

  // Trigger all registered callbacks
  for (const callback of alertCallbacks) {
    try {
      callback(message, error);
    } catch (e) {
      logger.warn({ callbackError: e }, 'Alert callback threw an error');
    }
  }
}

// ── Provider Implementation ──────────────────────────────────────────────────

export class PostgresMemoryProvider implements MemoryProvider {
  private pools = new Map<string, Pool>();
  private initializedDbs = new Set<string>();
  private maintenancePool: Pool;
  private coreDbName = 'overmind_core';
  private dbVectorSupport = new Map<string, boolean>();
  private dbCreationInProgress = new Set<string>(); // Track DB creation to avoid race conditions
  private poolCleanupHandlers = new Map<string, () => void>(); // Track cleanup handlers to prevent listener leak

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
    if (this.pools.has(dbName)) {
      const existingPool = this.pools.get(dbName)!;
      // Check if pool is still connected
      try {
        const client = await existingPool.connect();
        client.release();
        return existingPool;
      } catch {
        // Pool is dead, remove it and recreate
        this.pools.delete(dbName);
        logger.warn({ dbName }, 'Existing pool was dead, creating new one');
      }
    }

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
    const max = (poolOptions.max as number | undefined) || 2;
    const idleTimeoutMillis = (poolOptions.idleTimeoutMillis as number | undefined) || 5000;

    logger.info({ dbName, host, user }, 'Creating connection pool for database');

    try {
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

      // Test connection immediately
      const testClient = await newPool.connect();
      testClient.release();

      // Register error handler to prevent unhandled pool errors
      newPool.on('error', (err) => {
        logger.error(
          { dbName, error: err.message },
          'PostgreSQL pool error — will recreate on next use',
        );
      });

      // Register pool for cleanup on process exit (prevents connection leaks on long-running servers)
      // Only register once per dbName to prevent listener accumulation
      if (!this.poolCleanupHandlers.has(dbName)) {
        const cleanup = () => {
          void newPool.end().catch(() => {});
        };
        // Use prependOnceListener to avoid accumulating identical handlers
        // when getPoolFor() is called multiple times for the same dbName.
        // Each cleanup handler is a new function reference, so we guard
        // by dbName key (set above) to register at most once per database.
        process.prependOnceListener('uncaughtException', cleanup);
        process.prependOnceListener('exit', cleanup);
        this.poolCleanupHandlers.set(dbName, cleanup);
      }

      this.pools.set(dbName, newPool);
      return newPool;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error({ dbName, host, error: err.message }, 'CRITICAL: Failed to connect to database');
      triggerMemoryAlert(
        `❌ DATABASE UNAVAILABLE: Cannot connect to ${dbName} at ${host}. Memory will not be persisted!`,
        err,
      );
      throw error;
    }
  }

  private async ensureDatabaseExists(dbName: string): Promise<void> {
    // Prevent race conditions: if this DB is already being created, wait a bit and check again
    if (this.dbCreationInProgress.has(dbName)) {
      logger.error(
        `[PostgresMemory] ⏳ Database ${dbName} creation already in progress, waiting...`,
      );
      // Wait up to 5 seconds for the other process to finish
      for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        try {
          const testClient = new Client({
            host: process.env.POSTGRES_HOST || '127.0.0.1',
            port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
            user: process.env.POSTGRES_USER || 'postgres',
            password: process.env.POSTGRES_PASSWORD || '',
            database: dbName,
          });
          await testClient.connect();
          await testClient.end();
          logger.error(
            `[PostgresMemory] ✅ Database ${dbName} is now ready (was being created by another process).`,
          );
          return;
        } catch {
          // DB not ready yet, continue waiting
        }
      }
      logger.error(`[PostgresMemory] ⚠️  Waited too long for ${dbName}, proceeding anyway...`);
    }

    // Mark this DB as being created
    this.dbCreationInProgress.add(dbName);

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

    logger.error(
      `[PostgresMemory] Attempting to ensure DB ${dbName} exists via postgres maintenance DB...`,
    );
    const client = new Client(maintenanceClientConfig);
    try {
      await client.connect();
      const res = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
      if (res.rows.length === 0) {
        logger.error(`[PostgresMemory] 🏗️  Creating new physical database: ${dbName}`);
        // Validate dbName is a safe PostgreSQL identifier (alphanumeric + underscore only)
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(dbName)) {
          throw new Error(
            `Invalid database name: ${dbName}. Only alphanumeric and underscore characters allowed.`,
          );
        }
        // Double quote database name to handle reserved words
        await client.query(`CREATE DATABASE "${dbName}"`);
        logger.error(`[PostgresMemory] ✅ Database ${dbName} created.`);
      } else {
        logger.error(`[PostgresMemory] ℹ️  Database ${dbName} already exists.`);
      }
    } catch (err: unknown) {
      // Handle duplicate database error (code 42P04)
      if (err instanceof Error && (err as { code?: string }).code === '42P04') {
        logger.error(
          `[PostgresMemory] ℹ️  Database ${dbName} already exists (duplicate creation attempted).`,
        );
        return;
      }
      // Handle authentication errors more gracefully
      if (err instanceof Error && err.message.includes('password authentication failed')) {
        logger.error(
          `[PostgresMemory] ⚠️  Authentication failed for ${dbName}, but database may already exist. Continuing...`,
        );
        return;
      }
      logger.error({ dbName, error: err }, '[PostgresMemory] Critical: Failed to create database.');
      throw err;
    } finally {
      await client.end().catch(() => {});
      // Remove from in-progress set regardless of success/failure
      this.dbCreationInProgress.delete(dbName);
    }
  }

  private async initializeDb(dbName: string, pool: Pool): Promise<void> {
    if (this.initializedDbs.has(dbName)) return;

    const client = await pool.connect();
    try {
      // Extensions (Try to enable outside transaction to avoid aborting the whole thing)
      try {
        await client.query('CREATE EXTENSION IF NOT EXISTS vector');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `[PostgresMemory] CRITICAL: pgvector extension is REQUIRED but could not be enabled in ${dbName}. Error: ${msg}`,
          { cause: err },
        );
      }
      this.dbVectorSupport.set(dbName, true);

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

      // 2. Knowledge Chunks Table (VECTOR ONLY ENFORCED)
      const dimensions = parseInt(process.env.OVERMIND_EMBEDDING_DIMENSIONS || '4096', 10);
      const embeddingType = `vector(${dimensions})`;
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

      await client.query('COMMIT');

      // 4. Vector Optimizations & Indexing
      if (dimensions > 0) {
        if (dimensions <= 2000) {
          // Standard pgvector limit for HNSW is 2000 dimensions
          try {
            await client.query(`
              CREATE INDEX IF NOT EXISTS idx_knowledge_embedding_hnsw 
              ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)
              WITH (m = 16, ef_construction = 64)
            `);
          } catch (e) {
            logger.warn(
              `[PostgresMemory] ⚠️ Could not create HNSW index: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        } else {
          // > 2000D Optimization: Fast Exact K-NN Search
          try {
            logger.error(
              `[PostgresMemory] ⚡ Opting for Optimized Exact K-NN Search (High Dimensionality: ${dimensions}D).`,
            );
            // Boost parallelization for SeqScans on heavy high-dimensional vectors
            await client.query('ALTER TABLE knowledge_chunks SET (parallel_workers = 4)');
          } catch (_e) {
            // Fails silently if table optimization isn't supported / granted
          }
        }
      }

      this.initializedDbs.add(dbName);
      logger.error(
        `[PostgresMemory] ✅ Physical vault ${dbName} initialized (Vector: STRICTLY ENFORCED).`,
      );
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error({ dbName, error: e }, '[PostgresMemory] Failed to initialize tables.');
      throw e;
    } finally {
      client.release();
    }
  }

  async storeRun(params: StoreRunParams): Promise<string> {
    const dbName = this.getDbName(params.agentName || undefined);

    let pool: Pool;
    try {
      pool = await this.getPoolFor(dbName);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      triggerMemoryAlert(
        `❌ MEMORY STORE FAILED: Cannot store run for agent "${params.agentName}". Database unavailable: ${err.message}`,
        err,
      );
      throw error;
    }

    await this.initializeDb(dbName, pool);

    const id = randomId();
    try {
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
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      triggerMemoryAlert(
        `❌ MEMORY STORE FAILED: Cannot persist run to database ${dbName}. Error: ${err.message}`,
        err,
      );
      throw error;
    }
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
    if (!embedding || embedding.length === 0) {
      // Check si la clé API embedding est configurée
      const embKey = process.env.OVERMIND_EMBEDDING_KEY || process.env.OPENROUTER_API_KEY;
      if (!embKey || embKey.includes('...') || embKey === '') {
        logger.error(
          '[PostgresMemory] EMBEDDING_KEY manquante — memory_store échoue silencieusement. ' +
            'Configurez OVERMIND_EMBEDDING_KEY dans ~/.overmind/.env',
        );
        throw new Error(
          'EMBEDDING_NOT_CONFIGURED: OVERMIND_EMBEDDING_KEY manquante. ' +
            'Ajoutez OVERMIND_EMBEDDING_KEY=sk-or-v1-... dans ~/.overmind/.env',
        );
      }
      const err = new Error(
        `[PostgresMemory] CRITICAL: embedText() returned empty embedding for text chunk "${params.text.slice(0, 50)}...". ` +
          `Cannot store knowledge with NULL embedding — search would return corrupt results. ` +
          `Check OVERMIND_EMBEDDING_KEY / OVERMIND_EMBEDDING_URL / OVERMIND_EMBEDDING_MODEL.`,
      );
      triggerMemoryAlert(`❌ EMBEDDING FAILED: Cannot store knowledge chunk`, err);
      throw err;
    }
    const embStr = `[${embedding.join(',')}]`;

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
          // Improved Query: Semantic search + Time Decay (Freshness boost)
          // We fetch more candidates via HNSW index first, then re-rank with time decay
          const vecRes = await pool.query(
            `SELECT * FROM (
              SELECT id, text, source, created_at, 
                     (1 - (embedding <=> $1)) as semantic_score 
              FROM knowledge_chunks 
              WHERE embedding IS NOT NULL
              ORDER BY embedding <=> $1 
              LIMIT $2
            ) AS candidates
            ORDER BY (
              (semantic_score * 0.85) + 
              (1.0 / (1.0 + ln(1.0 + (extract(epoch from now()) * 1000 - created_at) / 86400000.0))) * 0.15
            ) DESC`,
            [embStr, Math.max(limit * 3, 50)], // Fetch more candidates for re-ranking
          );

          for (const row of vecRes.rows) {
            if (!seen.has(row.id)) {
              seen.add(row.id);
              const [type] = row.source.split('|');
              merged.push({
                id: row.id,
                text: row.text,
                source: row.source,
                score: parseFloat(row.semantic_score),
                created_at: parseInt(row.created_at, 10),
                match_type: type === 'pattern' || type === 'decision' ? 'structural' : 'vector',
              });
            }
          }
        } catch (e) {
          logger.error(
            { dbName, error: e },
            '[PostgresMemory] CRITICAL: Native vector search error (Fail Loudly).',
          );
          throw e; // Fail loudly instead of fallback
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
