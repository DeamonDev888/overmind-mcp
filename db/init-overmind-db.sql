-- ═══════════════════════════════════════════════════════════════════════════════
-- OverMind-MCP Database Initialization Script
-- ═══════════════════════════════════════════════════════════════════════════════
-- Script d'initialisation automatique pour PostgreSQL + pgvector
-- Exécuté automatiquement au premier démarrage du container
--
-- Fonctionnalités:
--   - Activation extension pgvector (4096D)
--   - Création base de données overmind_memory
--   - Optimisations performance pour OverMind
--   - Tables pour agents, mémoires, configurations
-- ═══════════════════════════════════════════════════════════════════════════════

-- Activer l'extension pgvector pour les embeddings 4096D
CREATE EXTENSION IF NOT EXISTS vector;

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE OVERMIND AGENTS
-- ═══════════════════════════════════════════════════════════════════════════════
-- Stocke les configurations d'agents créés par OverMind
CREATE TABLE IF NOT EXISTS overmind_agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) UNIQUE NOT NULL,
    runner VARCHAR(50) NOT NULL,
    model VARCHAR(255),
    prompt TEXT NOT NULL,
    config JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index pour recherches rapides d'agents
CREATE INDEX IF NOT EXISTS idx_overmind_agents_name ON overmind_agents(name);
CREATE INDEX IF NOT EXISTS idx_overmind_agents_runner ON overmind_agents(runner);

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE OVERMIND MEMORIES
-- ═══════════════════════════════════════════════════════════════════════════════
-- Stocke les mémoires vectorielles avec embeddings 4096D
CREATE TABLE IF NOT EXISTS overmind_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_name VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    embedding vector(4096),  -- Embeddings 4096D pour Qwen, Claude, etc.
    memory_type VARCHAR(50) DEFAULT 'user',  -- user, feedback, project, reference, error, decision
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index vectoriel pour recherches sémantiques rapides
CREATE INDEX IF NOT EXISTS idx_overmind_memories_embedding
ON overmind_memories
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Index pour filtres textuels
CREATE INDEX IF NOT EXISTS idx_overmind_memories_agent ON overmind_memories(agent_name);
CREATE INDEX IF NOT EXISTS idx_overmind_memories_type ON overmind_memories(memory_type);
CREATE INDEX IF NOT EXISTS idx_overmind_memories_created ON overmind_memories(created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE OVERMIND SESSIONS
-- ═══════════════════════════════════════════════════════════════════════════════
-- Stocke les sessions et historiques d'exécution
CREATE TABLE IF NOT EXISTS overmind_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_name VARCHAR(255) NOT NULL,
    runner VARCHAR(50) NOT NULL,
    prompt TEXT NOT NULL,
    result TEXT,
    status VARCHAR(50) DEFAULT 'pending',  -- pending, running, completed, failed
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB
);

-- Index pour historique des sessions
CREATE INDEX IF NOT EXISTS idx_overmind_sessions_agent ON overmind_sessions(agent_name);
CREATE INDEX IF NOT EXISTS idx_overmind_sessions_status ON overmind_sessions(status);
CREATE INDEX IF NOT EXISTS idx_overmind_sessions_started ON overmind_sessions(started_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════════
-- OPTIMISATIONS PERFORMANCE
-- ═══════════════════════════════════════════════════════════════════════════════

-- Configuration PostgreSQL pour OverMind
ALTER DATABASE overmind_memory SET shared_preload_libraries = 'vector';

-- Optimiser les statistiques pour les requêtes vectorielles
ANALYZE overmind_memories;
ANALYZE overmind_agents;
ANALYZE overmind_sessions;

-- ═══════════════════════════════════════════════════════════════════════════════
-- DONNÉES INITIALES (OPTIONNEL)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Insérer un agent de bienvenue
INSERT INTO overmind_agents (name, runner, model, prompt, config) VALUES (
    'welcome-agent',
    'claude',
    'claude-sonnet-4-6',
    'Tu es un agent de bienvenue OverMind. Aide les nouveaux utilisateurs à découvrir les capacités d''OverMind-MCP.',
    '{"temperature": 0.7, "max_tokens": 1000}'::jsonb
) ON CONFLICT (name) DO NOTHING;

-- Afficher un résumé de l'initialisation
DO $$
BEGIN
    RAISE NOTICE '═══════════════════════════════════════════════';
    RAISE NOTICE 'OverMind-MCP Database Initialized Successfully!';
    RAISE NOTICE '═══════════════════════════════════════════════';
    RAISE NOTICE '✅ pgvector extension activated (4096D)';
    RAISE NOTICE '✅ overmind_agents table created';
    RAISE NOTICE '✅ overmind_memories table created (with vector index)';
    RAISE NOTICE '✅ overmind_sessions table created';
    RAISE NOTICE '✅ Performance optimizations applied';
    RAISE NOTICE '═══════════════════════════════════════════════';
END $$;
