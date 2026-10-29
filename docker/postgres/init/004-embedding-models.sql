CREATE TABLE IF NOT EXISTS embedding_models (
  model_id TEXT PRIMARY KEY CHECK (model_id ~ '^[A-Za-z0-9][A-Za-z0-9._~-]*$'),
  dimensions INTEGER NOT NULL CHECK (dimensions > 0 AND dimensions <= 16000),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deprecated'))
);
