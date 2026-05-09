-- OverMind-MCP Database Initialization Script
-- Creates necessary extensions, databases, and schemas

-- ─── Enable pgvector extension ───────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── Core Memory Database ───────────────────────────────────────────────────────────────────
-- This is the main database for OverMind's RAG system

-- Agent Runs Table (stores execution history)
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
);

-- Knowledge Chunks Table (RAG vectors)
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  text TEXT NOT NULL,
  embedding vector(4096),
  model TEXT,
  created_at BIGINT DEFAULT extract(epoch from now()) * 1000,
  updated_at BIGINT DEFAULT extract(epoch from now()) * 1000
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_agent_runs_runner ON agent_runs(runner);
CREATE INDEX IF NOT EXISTS idx_agent_runs_session ON agent_runs(session_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_source ON knowledge_chunks(source);

-- HNSW Index for vector search (if dimensions ≤ 2000)
-- For 4096D, we use optimized exact K-NN search instead
CREATE INDEX IF NOT EXISTS idx_knowledge_embedding_hnsw
ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- ─── Temporal Database Setup (if using Temporal) ───────────────────────────────────────────
-- Note: Temporal auto-setup handles most of this, but we ensure the DB exists

-- ─── Permissions & Security ────────────────────────────────────────────────────────────────
-- Grant necessary permissions (adjust based on your security model)

-- Grant usage on schemas
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO postgres;

-- ─── Sample Data (Optional - for testing) ───────────────────────────────────────────────────
-- INSERT INTO knowledge_chunks (id, source, text, embedding, model)
-- VALUES (
--   'test_knowledge_1',
--   'system',
--   'OverMind-MCP is an AI agent orchestrator supporting multiple runners.',
--   NULL, -- Embedding will be generated when storing
--   'qwen/qwen3-embedding-8b'
-- );

-- ─── Maintenance Functions ──────────────────────────────────────────────────────────────────

-- Function to clean old agent runs (retention policy)
CREATE OR REPLACE FUNCTION clean_old_agent_runs(retention_days INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM agent_runs
  WHERE created_at < extract(epoch from now()) * 1000 - (retention_days * 86400000);

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get memory stats
CREATE OR REPLACE FUNCTION get_memory_stats()
RETURNS TABLE (
  total_runs BIGINT,
  total_knowledge BIGINT,
  success_rate NUMERIC,
  avg_duration_ms NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM agent_runs) as total_runs,
    (SELECT COUNT(*) FROM knowledge_chunks) as total_knowledge,
    (SELECT CASE WHEN COUNT(*) > 0 THEN
       (SELECT COUNT(*) FROM agent_runs WHERE success = 1)::NUMERIC / COUNT(*) * 100
       ELSE 0 END FROM agent_runs) as success_rate,
    (SELECT AVG(duration_ms) FROM agent_runs WHERE duration_ms IS NOT NULL) as avg_duration_ms;
END;
$$ LANGUAGE plpgsql;

-- ─── Completion Message ─────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'OverMind-MCP database initialized successfully!';
  RAISE NOTICE 'Extensions: pgvector enabled';
  RAISE NOTICE 'Tables: agent_runs, knowledge_chunks created';
  RAISE NOTICE 'Indexes: HNSW vector index created';
  RAISE NOTICE 'Functions: clean_old_agent_runs, get_memory_stats created';
END $$;
