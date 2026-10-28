CREATE TABLE IF NOT EXISTS documents (
  document_id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  source_label TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  lineage JSONB NOT NULL,
  created_at TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  retention_state TEXT NOT NULL CHECK (retention_state IN ('active', 'tombstone', 'purged'))
);

CREATE TABLE IF NOT EXISTS segments (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
  segment_index INTEGER NOT NULL CHECK (segment_index >= 0),
  text TEXT NOT NULL,
  start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
  end_offset INTEGER NOT NULL CHECK (end_offset >= start_offset),
  text_sha256 TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  provenance JSONB NOT NULL,
  search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', text)) STORED,
  UNIQUE (document_id, segment_index)
);

CREATE INDEX IF NOT EXISTS segments_search_vector_idx ON segments USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS documents_owner_retention_idx ON documents (owner_id, retention_state);
