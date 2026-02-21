import { DatabaseSync } from 'node:sqlite';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { ensureOrchestratorSchema } from './schema.js';
import { embedText, cosineSimilarity } from './embeddings.js';

// ── DB Path ──────────────────────────────────────────────────────────────────

function getMemoryDir(): string {
  const env = process.env.OVERMIND_MEMORY_DIR;
  if (env) return env;
  const home = os.homedir();
  return path.join(home, '.overmind-mcp', 'memory');
}

function openDB(): DatabaseSync {
  const dir = getMemoryDir();
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, 'overmind.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL;');
  db.exec('PRAGMA synchronous=NORMAL;');
  ensureOrchestratorSchema(db);
  return db;
}

// ── Singleton ────────────────────────────────────────────────────────────────

let _db: DatabaseSync | null = null;

function getDB(): DatabaseSync {
  if (!_db) _db = openDB();
  return _db;
}

// ── Types ────────────────────────────────────────────────────────────────────

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

// ── Internal helpers ─────────────────────────────────────────────────────────

function randomId(): string {
  return crypto.randomBytes(8).toString('hex');
}

function now(): number {
  return Date.now();
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Record an agent execution in orchestration memory.
 * Called automatically by every Runner after execution.
 */
export function storeRun(params: {
  runner: string;
  agentName?: string;
  prompt: string;
  result?: string;
  error?: string;
  durationMs?: number;
  success: boolean;
  sessionId?: string;
}): string {
  const db = getDB();
  const id = randomId();
  const stmt = db.prepare(`
    INSERT INTO agent_runs
      (id, runner, agent_name, prompt, result, error, duration_ms, success, session_id, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `);
  stmt.run(
    id,
    params.runner,
    params.agentName ?? null,
    params.prompt.slice(0, 4096),
    params.result?.slice(0, 8192) ?? null,
    params.error ?? null,
    params.durationMs ?? null,
    params.success ? 1 : 0,
    params.sessionId ?? null,
    now(),
  );
  return id;
}

/**
 * Store a piece of durable knowledge (vectorised).
 */
export async function storeKnowledge(params: {
  text: string;
  source?: string;
}): Promise<string> {
  const db = getDB();
  const id = `k_${sha256(params.text)}_${randomId()}`;
  const source = params.source ?? 'user';
  const ts = now();

  const { embedding, model } = await embedText(params.text);
  const embStr = JSON.stringify(embedding);

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO knowledge_chunks
      (id, source, text, embedding, model, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?)
  `);
  stmt.run(id, source, params.text, embStr, model, ts, ts);

  // FTS
  try {
    db.prepare(`INSERT OR REPLACE INTO knowledge_fts (text, id, source) VALUES (?,?,?)`)
      .run(params.text, id, source);
  } catch {
    // FTS not available
  }

  return id;
}

/**
 * Hybrid semantic + FTS search over knowledge and (optionally) run history.
 */
export async function searchMemory(params: {
  query: string;
  limit?: number;
  includeRuns?: boolean;
}): Promise<SearchResult[]> {
  const db = getDB();
  const limit = params.limit ?? 10;

  const { embedding: queryEmb } = await embedText(params.query);

  // 1. Vector search over knowledge_chunks
  const chunks = db.prepare('SELECT id, source, text, embedding, created_at FROM knowledge_chunks').all() as unknown as KnowledgeChunk[];

  const vectorResults: SearchResult[] = chunks
    .map((chunk) => {
      let score = 0;
      if (chunk.embedding) {
        try {
          const emb = JSON.parse(chunk.embedding) as number[];
          score = cosineSimilarity(queryEmb, emb);
        } catch {
          score = 0;
        }
      }
      return {
        id: chunk.id,
        text: chunk.text,
        source: chunk.source,
        score,
        created_at: chunk.created_at,
        match_type: 'vector' as const,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // 2. FTS5 search
  const ftsResults: SearchResult[] = [];
  try {
    type FTSRow = { id: string; text: string; source: string; created_at?: number };
    const rows = db.prepare(`
      SELECT f.id, f.text, f.source, c.created_at
      FROM knowledge_fts f
      LEFT JOIN knowledge_chunks c ON c.id = f.id
      WHERE knowledge_fts MATCH ?
      LIMIT ?
    `).all(params.query, limit) as FTSRow[];

    for (const row of rows) {
      ftsResults.push({
        id: row.id,
        text: row.text,
        source: row.source,
        score: 0.7, // FTS has good relevance, assign fixed score
        created_at: row.created_at ?? 0,
        match_type: 'fts',
      });
    }
  } catch {
    // FTS not available or query syntax error
  }

  // 3. Merge and deduplicate
  const seen = new Set<string>();
  const merged: SearchResult[] = [];

  for (const r of [...vectorResults, ...ftsResults]) {
    if (!seen.has(r.id) && r.score > 0.05) {
      seen.add(r.id);
      merged.push(r);
    }
  }

  // 4. Optionally include matching run history (FTS-only)
  if (params.includeRuns) {
    type RunRow = { id: string; runner: string; prompt: string; result: string | null; created_at: number };
    const qLike = `%${params.query.slice(0, 100)}%`;
    const runs = db.prepare(`
      SELECT id, runner, prompt, result, created_at
      FROM agent_runs
      WHERE prompt LIKE ? OR result LIKE ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(qLike, qLike, Math.ceil(limit / 2)) as RunRow[];

    for (const r of runs) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        merged.push({
          id: r.id,
          text: `[${r.runner}] ${r.prompt.slice(0, 200)}`,
          source: 'agent_run',
          score: 0.5,
          created_at: r.created_at,
          match_type: 'fts',
        });
      }
    }
  }

  return merged.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Get recent agent runs, optionally filtered by runner name.
 */
export function getRecentRuns(params: {
  runner?: string;
  limit?: number;
}): AgentRun[] {
  const db = getDB();
  const limit = params.limit ?? 20;

  if (params.runner) {
    return db.prepare(`
      SELECT * FROM agent_runs WHERE runner = ? ORDER BY created_at DESC LIMIT ?
    `).all(params.runner, limit) as unknown as AgentRun[];
  }

  return db.prepare(`
    SELECT * FROM agent_runs ORDER BY created_at DESC LIMIT ?
  `).all(limit) as unknown as AgentRun[];
}

/**
 * Get a summary of all orchestration activity.
 */
export function getStats(): Record<string, unknown> {
  const db = getDB();
  type CountRow = { count: number };
  type RunnerRow = { runner: string; count: number; successes: number };

  const totalRuns = (db.prepare('SELECT COUNT(*) as count FROM agent_runs').get() as CountRow).count;
  const totalKnowledge = (db.prepare('SELECT COUNT(*) as count FROM knowledge_chunks').get() as CountRow).count;
  const byRunner = db.prepare(`
    SELECT runner, COUNT(*) as count, SUM(success) as successes FROM agent_runs GROUP BY runner
  `).all() as RunnerRow[];

  return { totalRuns, totalKnowledge, byRunner };
}
