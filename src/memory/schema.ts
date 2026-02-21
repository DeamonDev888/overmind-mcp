import type { DatabaseSync } from 'node:sqlite';

export interface SchemaResult {
  ftsAvailable: boolean;
  ftsError?: string;
}

export function ensureOrchestratorSchema(db: DatabaseSync): SchemaResult {
  // ── Meta ─────────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // ── Agent Runs ────────────────────────────────────────────────────────────
  // Core orchestration memory: every agent call is recorded here.
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id            TEXT    PRIMARY KEY,
      runner        TEXT    NOT NULL,
      agent_name    TEXT,
      prompt        TEXT    NOT NULL,
      result        TEXT,
      error         TEXT,
      duration_ms   INTEGER,
      success       INTEGER NOT NULL DEFAULT 1,
      session_id    TEXT,
      created_at    INTEGER NOT NULL
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_runs_runner     ON agent_runs(runner);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_runs_created_at ON agent_runs(created_at);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_runs_session    ON agent_runs(session_id);`);

  // ── Orchestration Sessions ────────────────────────────────────────────────
  // Multi-agent workflows, grouping several agent_runs together.
  db.exec(`
    CREATE TABLE IF NOT EXISTS orchestration_sessions (
      id          TEXT    PRIMARY KEY,
      name        TEXT,
      description TEXT,
      status      TEXT    NOT NULL DEFAULT 'active',
      run_ids     TEXT    NOT NULL DEFAULT '[]',
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
  `);

  // ── Knowledge Chunks ──────────────────────────────────────────────────────
  // Durable long-term knowledge, indexed for semantic search.
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id         TEXT    PRIMARY KEY,
      source     TEXT    NOT NULL DEFAULT 'user',
      text       TEXT    NOT NULL,
      embedding  TEXT,
      model      TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chunks_source ON knowledge_chunks(source);`);

  // ── Embedding Cache ───────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS embedding_cache (
      hash       TEXT    PRIMARY KEY,
      model      TEXT    NOT NULL,
      embedding  TEXT    NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  // ── FTS5 Full-Text Search ─────────────────────────────────────────────────
  let ftsAvailable = false;
  let ftsError: string | undefined;

  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
        text,
        id     UNINDEXED,
        source UNINDEXED
      );
    `);
    ftsAvailable = true;
  } catch (err) {
    ftsError = err instanceof Error ? err.message : String(err);
  }

  return { ftsAvailable, ...(ftsError ? { ftsError } : {}) };
}
