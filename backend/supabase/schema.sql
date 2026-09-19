-- =============================================================================
-- CloseFuture AI Agent - Database Schema
-- Target: PostgreSQL / Supabase
-- =============================================================================

-- 1. Enable pgvector extension for embedding search
CREATE EXTENSION IF NOT EXISTS vector
WITH SCHEMA extensions;

-- =============================================================================
-- Table: sessions
-- Tracks chat sessions, lead qualification state, and optimistic concurrency version
-- =============================================================================
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visitor_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    email TEXT NULL,
    name TEXT NULL,
    company TEXT NULL,
    timezone TEXT NULL,
    lead_score INTEGER NULL,
    booked_event_id TEXT NULL,
    summary_sent BOOLEAN NOT NULL DEFAULT FALSE,
    summary_email_id TEXT NULL,
    summary_version INTEGER NOT NULL DEFAULT 0,
    summary_status TEXT NOT NULL DEFAULT 'not_sent' CHECK (summary_status IN ('not_sent', 'pending', 'sent', 'failed')),
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NULL
);

-- =============================================================================
-- Table: messages
-- Stores chat history per session for multi-agent reasoning and context reconstruction
-- =============================================================================
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    agent TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- Table: agent_logs
-- Observability and audit trail for agent actions, tool calls, and error tracking
-- =============================================================================
CREATE TABLE IF NOT EXISTS agent_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NULL REFERENCES sessions(id) ON DELETE CASCADE,
    agent TEXT NOT NULL,
    action TEXT NOT NULL,
    input JSONB NULL,
    output JSONB NULL,
    status TEXT NULL,
    error_code TEXT NULL,
    retryable BOOLEAN NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- Table: knowledge_chunks
-- Grounding chunks for CloseFuture company profile with 1536-dim vector embeddings
-- (Optimized for text-embedding-3-small)
-- =============================================================================
CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT NOT NULL,
    source_page INTEGER NULL,
    source_section TEXT NULL,
    document_type TEXT NULL,
    category TEXT NULL,
    chunk_index INTEGER NULL,
    embedding extensions.vector(1536) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- Indexes
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_logs_session_id ON agent_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_category ON knowledge_chunks(category);

-- HNSW cosine distance index for fast approximate nearest-neighbor vector search
CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_hnsw
ON knowledge_chunks
USING hnsw (embedding vector_cosine_ops);

-- =============================================================================
-- Vector Search RPC Function: match_knowledge
-- Cosine distance similarity search over grounded knowledge chunks
-- =============================================================================
CREATE OR REPLACE FUNCTION match_knowledge(
    query_embedding extensions.vector(1536),
    match_count INTEGER DEFAULT 5,
    match_threshold DOUBLE PRECISION DEFAULT 0.70,
    filter_category TEXT DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    content TEXT,
    source_page INTEGER,
    source_section TEXT,
    document_type TEXT,
    category TEXT,
    similarity DOUBLE PRECISION
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        kc.id,
        kc.content,
        kc.source_page,
        kc.source_section,
        kc.document_type,
        kc.category,
        (1 - (kc.embedding <=> query_embedding))::DOUBLE PRECISION AS similarity
    FROM knowledge_chunks kc
    WHERE (filter_category IS NULL OR kc.category = filter_category)
      AND (1 - (kc.embedding <=> query_embedding)) >= match_threshold
    ORDER BY kc.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- =============================================================================
-- Row Level Security (RLS)
-- =============================================================================
-- Row Level Security is explicitly enabled on all four application tables.
-- The backend accesses the database exclusively via the backend secret key
-- (service role), which bypasses Row Level Security.
-- Permissive anon/public policies are deliberately NOT created to prevent
-- unauthorized direct client-side access to sessions, messages, logs, or knowledge.

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;
