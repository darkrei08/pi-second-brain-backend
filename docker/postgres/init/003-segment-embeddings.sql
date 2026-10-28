CREATE TABLE IF NOT EXISTS segment_embeddings (
  segment_id TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  dimensions INTEGER NOT NULL CHECK (dimensions > 0 AND dimensions <= 16000),
  embedding VECTOR NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (segment_id, model_id)
);

CREATE INDEX IF NOT EXISTS segment_embeddings_model_idx ON segment_embeddings (model_id);
