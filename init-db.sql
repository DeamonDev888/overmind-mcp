-- OverMind-MCP PostgreSQL Initialization
-- This script initializes the database with pgvector extension

-- Create pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create memory table for RAG
CREATE TABLE IF NOT EXISTS memory (
    id SERIAL PRIMARY KEY,
    agent_name VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    embedding vector(4096),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for vector similarity search
CREATE INDEX IF NOT EXISTS memory_embedding_idx ON memory 
USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Create index for agent queries
CREATE INDEX IF NOT EXISTS memory_agent_name_idx ON memory(agent_name);

-- Create agents configuration table
CREATE TABLE IF NOT EXISTS agents (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    runner VARCHAR(50) NOT NULL,
    model VARCHAR(100),
    prompt TEXT NOT NULL,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for agent lookups
CREATE INDEX IF NOT EXISTS agents_name_idx ON agents(name);

-- Create runs history table
CREATE TABLE IF NOT EXISTS runs (
    id SERIAL PRIMARY KEY,
    agent_name VARCHAR(255) NOT NULL,
    runner VARCHAR(50) NOT NULL,
    prompt TEXT NOT NULL,
    result TEXT,
    status VARCHAR(50) DEFAULT 'running',
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'
);

-- Create index for run queries
CREATE INDEX IF NOT EXISTS runs_agent_name_idx ON runs(agent_name);
CREATE INDEX IF NOT EXISTS runs_status_idx ON runs(status);
CREATE INDEX IF NOT EXISTS runs_started_at_idx ON runs(started_at);

-- Grant permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO postgres;

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'OverMind-MCP database initialized successfully!';
    RAISE NOTICE 'Created tables: memory, agents, runs';
    RAISE NOTICE 'Enabled extensions: vector (pgvector)';
END $$;
