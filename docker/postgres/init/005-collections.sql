CREATE TABLE IF NOT EXISTS collections (
  collection_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (collection_id, owner_id)
);

CREATE INDEX IF NOT EXISTS collections_owner_idx ON collections (owner_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'documents_document_owner_unique'
  ) THEN
    ALTER TABLE documents
      ADD CONSTRAINT documents_document_owner_unique UNIQUE (document_id, owner_id);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS document_collections (
  collection_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  PRIMARY KEY (collection_id, document_id),
  FOREIGN KEY (collection_id, owner_id)
    REFERENCES collections (collection_id, owner_id) ON DELETE CASCADE,
  FOREIGN KEY (document_id, owner_id)
    REFERENCES documents (document_id, owner_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS document_collections_document_idx
  ON document_collections (document_id);
