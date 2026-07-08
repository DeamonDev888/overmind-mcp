/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║   OVERMIND BRIDGE — MessageLog (Postgres Persistence)                ║
 * ║                                                                      ║
 * ║   Persiste tous les messages agent↔agent et client→agent dans       ║
 * ║   Postgres pour audit, replay après crash, et statistiques.          ║
 * ║                                                                      ║
 * ║   TABLE                                                              ║
 * ║   ──────                                                             ║
 * ║   bridge_messages                                                    ║
 * ║     id              UUID PK                                          ║
 * ║     from_agent      TEXT NULL   (NULL = client externe)              ║
 * ║     to_agent        TEXT NOT NULL                                    ║
 * ║     runner          TEXT NOT NULL                                    ║
 * ║     prompt          TEXT NOT NULL                                    ║
 * ║     response        TEXT NULL                                        ║
 * ║     status          TEXT NOT NULL (pending|running|done|failed)     ║
 * ║     session_id      TEXT NULL                                        ║
 * ║     metadata        JSONB NULL   (path, model, mode, discord ctx)    ║
 * ║     error           TEXT NULL                                        ║
 * ║     created_at      TIMESTAMPTZ                                      ║
 * ║     started_at      TIMESTAMPTZ NULL                                 ║
 * ║     completed_at    TIMESTAMPTZ NULL                                 ║
 * ║     duration_ms     INTEGER NULL                                     ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import pg from 'pg';
import { createBridgeLogger, type BridgeLogger } from './utils.js';
import type { RunnerType } from './types.js';

// ─── Public Types ─────────────────────────────────────────────────────────

export type MessageStatus = 'pending' | 'running' | 'done' | 'failed' | 'timeout';

export interface PersistedMessage {
  id: string;
  fromAgent: string | null;
  toAgent: string;
  runner: RunnerType;
  prompt: string;
  response: string | null;
  status: MessageStatus;
  sessionId: string | null;
  metadata: Record<string, unknown> | null;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
}

export interface CreateMessageInput {
  fromAgent?: string | null;
  toAgent: string;
  runner: RunnerType;
  prompt: string;
  sessionId?: string;
  metadata?: Record<string, unknown> | null;
}

export interface ListMessagesFilter {
  toAgent?: string;
  /** null = filtre les messages sans fromAgent (i.e. venant d'un client externe) */
  fromAgent?: string | null;
  status?: MessageStatus;
  /** Limite de résultats (default: 50) */
  limit?: number;
  /** Offset pour pagination (default: 0) */
  offset?: number;
  /** Depuis N heures (ex: 24 = dernières 24h) */
  sinceHours?: number;
}

export interface MessageLogConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  /** SSL (default: false) */
  ssl?: boolean;
  /** Pool min/max (default: 2/10) */
  poolMin?: number;
  poolMax?: number;
}

// ─── Schema SQL ───────────────────────────────────────────────────────────

const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS bridge_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_agent    TEXT NULL,
  to_agent      TEXT NOT NULL,
  runner        TEXT NOT NULL,
  prompt        TEXT NOT NULL,
  response      TEXT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  session_id    TEXT NULL,
  metadata      JSONB NULL,
  error         TEXT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at    TIMESTAMPTZ NULL,
  completed_at  TIMESTAMPTZ NULL,
  duration_ms   INTEGER NULL
);

CREATE INDEX IF NOT EXISTS idx_bridge_messages_status     ON bridge_messages(status);
CREATE INDEX IF NOT EXISTS idx_bridge_messages_to_agent   ON bridge_messages(to_agent, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bridge_messages_from_agent ON bridge_messages(from_agent, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bridge_messages_session    ON bridge_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_bridge_messages_created    ON bridge_messages(created_at DESC);
`;

// ─── MessageLog ───────────────────────────────────────────────────────────

export class MessageLog {
  private pool: pg.Pool | undefined;
  private readonly log: BridgeLogger;
  private initialized = false;

  constructor(
    private readonly config: MessageLogConfig,
    logger?: BridgeLogger,
  ) {
    this.log = logger ?? createBridgeLogger('message-log');
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  /**
   * Initialise le pool Postgres et crée le schéma si nécessaire.
   * Idempotent : peut être appelé plusieurs fois sans danger.
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    this.log.info(
      `🐘 Connecting to Postgres ${this.config.host}:${this.config.port}/${this.config.database}...`,
    );

    this.pool = new pg.Pool({
      host: this.config.host,
      port: this.config.port,
      user: this.config.user,
      password: this.config.password,
      database: this.config.database,
      ssl: this.config.ssl ? { rejectUnauthorized: false } : false,
      min: this.config.poolMin ?? 2,
      max: this.config.poolMax ?? 10,
      idleTimeoutMillis: 30_000,
    });

    // Test connexion
    const client = await this.pool.connect();
    try {
      await client.query('SELECT 1');
      this.log.info('🐘 Postgres connection OK');
    } finally {
      client.release();
    }

    // Crée le schéma
    await this.pool.query(SCHEMA_SQL);
    this.log.info('🐘 Schema bridge_messages ready');
    this.initialized = true;
  }

  /**
   * Ferme proprement le pool.
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = undefined;
      this.initialized = false;
      this.log.info('🐘 Postgres pool closed');
    }
  }

  // ─── CRUD ────────────────────────────────────────────────────────────────

  /**
   * Crée un message en status 'pending' et retourne son ID.
   */
  async create(input: CreateMessageInput): Promise<string> {
    this.assertReady();
    const result = await this.pool!.query<{ id: string }>(
      `INSERT INTO bridge_messages
         (from_agent, to_agent, runner, prompt, session_id, metadata, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING id`,
      [
        input.fromAgent ?? null,
        input.toAgent,
        input.runner,
        input.prompt,
        input.sessionId ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
      ],
    );
    return result.rows[0].id;
  }

  /**
   * Marque un message comme 'running' (appel MCP en cours).
   */
  async markRunning(id: string, sessionId?: string): Promise<void> {
    this.assertReady();
    await this.pool!.query(
      `UPDATE bridge_messages
       SET status = 'running', started_at = now(), session_id = COALESCE($2, session_id)
       WHERE id = $1`,
      [id, sessionId ?? null],
    );
  }

  /**
   * Marque un message comme 'done' avec sa réponse.
   */
  async markDone(id: string, response: string, sessionId?: string): Promise<void> {
    this.assertReady();
    await this.pool!.query(
      `UPDATE bridge_messages
       SET status = 'done',
           response = $2,
           session_id = COALESCE($3, session_id),
           completed_at = now(),
           duration_ms = EXTRACT(MILLISECOND FROM (now() - started_at))::int
                          + EXTRACT(SECOND FROM (now() - started_at))::int * 1000
                          + EXTRACT(MINUTE FROM (now() - started_at))::int * 60_000
       WHERE id = $1`,
      [id, response, sessionId ?? null],
    );
  }

  /**
   * Marque un message comme 'failed' avec erreur.
   */
  async markFailed(id: string, error: string): Promise<void> {
    this.assertReady();
    await this.pool!.query(
      `UPDATE bridge_messages
       SET status = 'failed', error = $2, completed_at = now()
       WHERE id = $1`,
      [id, error],
    );
  }

  /**
   * Marque un message comme 'timeout'.
   */
  async markTimeout(id: string): Promise<void> {
    this.assertReady();
    await this.pool!.query(
      `UPDATE bridge_messages
       SET status = 'timeout', completed_at = now()
       WHERE id = $1`,
      [id],
    );
  }

  /**
   * Récupère un message par ID.
   */
  async getById(id: string): Promise<PersistedMessage | null> {
    this.assertReady();
    const result = await this.pool!.query<DbRow>('SELECT * FROM bridge_messages WHERE id = $1', [
      id,
    ]);
    return result.rows[0] ? rowToMessage(result.rows[0]) : null;
  }

  /**
   * Liste les messages avec filtres et pagination.
   */
  async list(filter: ListMessagesFilter = {}): Promise<PersistedMessage[]> {
    this.assertReady();
    const limit = filter.limit ?? 50;
    const offset = filter.offset ?? 0;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.toAgent) {
      params.push(filter.toAgent);
      conditions.push(`to_agent = $${params.length}`);
    }
    if (filter.fromAgent !== undefined) {
      if (filter.fromAgent === null) {
        conditions.push(`from_agent IS NULL`);
      } else {
        params.push(filter.fromAgent);
        conditions.push(`from_agent = $${params.length}`);
      }
    }
    if (filter.status) {
      params.push(filter.status);
      conditions.push(`status = $${params.length}`);
    }
    if (filter.sinceHours) {
      params.push(filter.sinceHours);
      conditions.push(`created_at > now() - ($${params.length} || ' hours')::interval`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit, offset);

    const result = await this.pool!.query<DbRow>(
      `SELECT * FROM bridge_messages ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return result.rows.map(rowToMessage);
  }

  /**
   * Trouve les messages 'pending' ou 'running' depuis plus de X minutes (stuck).
   * Utile pour le replay automatique au redémarrage.
   */
  async findStuck(stuckAfterMinutes = 5): Promise<PersistedMessage[]> {
    this.assertReady();
    const result = await this.pool!.query<DbRow>(
      `SELECT * FROM bridge_messages
       WHERE status IN ('pending', 'running')
         AND created_at < now() - ($1 || ' minutes')::interval
       ORDER BY created_at ASC`,
      [stuckAfterMinutes],
    );
    return result.rows.map(rowToMessage);
  }

  /**
   * Statistiques globales du log.
   */
  async stats(sinceHours = 24): Promise<{
    total: number;
    byStatus: Record<MessageStatus, number>;
    byRunner: Record<string, number>;
    avgDurationMs: number | null;
  }> {
    this.assertReady();
    const result = await this.pool!.query<{
      total: string;
      avg_duration: string | null;
    }>(
      `SELECT COUNT(*)::text AS total, AVG(duration_ms)::text AS avg_duration
       FROM bridge_messages
       WHERE created_at > now() - ($1 || ' hours')::interval`,
      [sinceHours],
    );

    const byStatusResult = await this.pool!.query<{ status: string; count: string }>(
      `SELECT status, COUNT(*)::text AS count
       FROM bridge_messages
       WHERE created_at > now() - ($1 || ' hours')::interval
       GROUP BY status`,
      [sinceHours],
    );

    const byRunnerResult = await this.pool!.query<{ runner: string; count: string }>(
      `SELECT runner, COUNT(*)::text AS count
       FROM bridge_messages
       WHERE created_at > now() - ($1 || ' hours')::interval
       GROUP BY runner`,
      [sinceHours],
    );

    const total = Number(result.rows[0]?.total ?? 0);
    const byStatus: Record<MessageStatus, number> = {
      pending: 0,
      running: 0,
      done: 0,
      failed: 0,
      timeout: 0,
    };
    for (const row of byStatusResult.rows) {
      byStatus[row.status as MessageStatus] = Number(row.count);
    }
    const byRunner: Record<string, number> = {};
    for (const row of byRunnerResult.rows) {
      byRunner[row.runner] = Number(row.count);
    }
    const avgDurationMs = result.rows[0]?.avg_duration
      ? Math.round(Number(result.rows[0].avg_duration))
      : null;

    return { total, byStatus, byRunner, avgDurationMs };
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  private assertReady(): void {
    if (!this.initialized || !this.pool) {
      throw new Error('MessageLog not initialized. Call init() first.');
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

interface DbRow {
  id: string;
  from_agent: string | null;
  to_agent: string;
  runner: string;
  prompt: string;
  response: string | null;
  status: MessageStatus;
  session_id: string | null;
  metadata: Record<string, unknown> | null;
  error: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  duration_ms: number | null;
}

function rowToMessage(row: DbRow): PersistedMessage {
  return {
    id: row.id,
    fromAgent: row.from_agent,
    toAgent: row.to_agent,
    runner: row.runner as RunnerType,
    prompt: row.prompt,
    response: row.response,
    status: row.status,
    sessionId: row.session_id,
    metadata: row.metadata,
    error: row.error,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
  };
}

// ─── Env Loader ───────────────────────────────────────────────────────────

/**
 * Charge la config Postgres depuis process.env (POSTGRES_*).
 * Utilise les variables déjà dans .env.
 */
export function loadMessageLogConfigFromEnv(): MessageLogConfig {
  const num = (v: string | undefined, def: number): number => {
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) ? n : def;
  };
  return {
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: num(process.env.POSTGRES_PORT, 5432),
    user: process.env.POSTGRES_USER ?? 'postgres',
    password: process.env.POSTGRES_PASSWORD ?? '',
    database: process.env.POSTGRES_DATABASE ?? process.env.POSTGRES_DB ?? 'overmind_memory',
    ssl: process.env.POSTGRES_SSL === 'true',
    poolMin: num(process.env.POSTGRES_POOL_MIN, 2),
    poolMax: num(process.env.POSTGRES_POOL_MAX, 10),
  };
}
