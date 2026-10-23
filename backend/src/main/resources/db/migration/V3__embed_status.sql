-- Step 5: indexing state for each source (screen shows pending -> indexing -> indexed / failed)
ALTER TABLE source_documents
    ADD COLUMN IF NOT EXISTS embed_status VARCHAR(20) NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS embed_error  TEXT,
    ADD COLUMN IF NOT EXISTS chunk_count  INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS indexed_at   TIMESTAMPTZ;

ALTER TABLE source_documents
    ADD CONSTRAINT chk_source_documents_embed_status
    CHECK (embed_status IN ('pending', 'indexing', 'indexed', 'failed'));

CREATE INDEX IF NOT EXISTS idx_chunks_source_document_id ON chunks (source_document_id);

-- The HNSW index on chunks.embedding already exists from V1, so it is NOT recreated here.
-- If it does not, add:
-- CREATE INDEX idx_chunks_embedding_hnsw ON chunks USING hnsw (embedding vector_cosine_ops);
