const DEFAULT_SEARCH_LIMIT = 20;
const MAX_VECTOR_DIMENSIONS = 16000;
const DOCUMENT_ID_PATTERN = /^urn:document:[A-Za-z0-9][A-Za-z0-9._~-]*$/;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]*$/;
const RETENTION_STATES = new Set(['active', 'tombstone', 'purged']);
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

function requirePool(pool) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new TypeError('pool must provide connect()');
  }
}

function requireText(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be non-empty text`);
  }
}

function requireObject(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
}

function requireOpaqueId(value, name) {
  if (typeof value !== 'string' || !OPAQUE_ID_PATTERN.test(value)) {
    throw new TypeError(`${name} must be opaque`);
  }
}

function validateVector(vector, dimensions, name) {
  if (!Array.isArray(vector) || vector.length !== dimensions) {
    throw new TypeError(`${name} must have exactly ${dimensions} dimensions`);
  }
  let hasNonZeroValue = false;
  for (const value of vector) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`${name} values must be finite numbers`);
    }
    if (value !== 0) hasNonZeroValue = true;
  }
  if (!hasNonZeroValue) {
    throw new TypeError(`${name} must have a non-zero norm`);
  }
}

function vectorLiteral(vector) {
  return `[${vector.join(',')}]`;
}

function validateSegmentEmbeddingsInput({ document_id, owner_id, model_id, dimensions, embeddings, created_at }) {
  if (typeof document_id !== 'string' || !DOCUMENT_ID_PATTERN.test(document_id)) {
    throw new TypeError('document_id must be an opaque document URN');
  }
  requireOpaqueId(owner_id, 'owner_id');
  requireOpaqueId(model_id, 'model_id');
  if (!Number.isInteger(dimensions) || dimensions <= 0 || dimensions > MAX_VECTOR_DIMENSIONS) {
    throw new TypeError(`dimensions must be an integer between 1 and ${MAX_VECTOR_DIMENSIONS}`);
  }
  if (!Array.isArray(embeddings) || embeddings.length === 0) {
    throw new TypeError('embeddings must be non-empty');
  }
  if (typeof created_at !== 'string' || !RFC3339_PATTERN.test(created_at) || Number.isNaN(Date.parse(created_at))) {
    throw new TypeError('created_at must be RFC3339');
  }
  const segmentIds = new Set();
  for (const [index, entry] of embeddings.entries()) {
    requireObject(entry, `embeddings[${index}]`);
    requireText(entry.segment_id, `embeddings[${index}].segment_id`);
    if (segmentIds.has(entry.segment_id)) {
      throw new TypeError('embeddings must not contain duplicate segment IDs');
    }
    segmentIds.add(entry.segment_id);
    validateVector(entry.embedding, dimensions, `embeddings[${index}].embedding`);
  }
}

function validateQueryEmbedding({ query_embedding, model_id, owner_id, limit }) {
  requireOpaqueId(model_id, 'model_id');
  requireOpaqueId(owner_id, 'owner_id');
  if (!Array.isArray(query_embedding) || query_embedding.length === 0 || query_embedding.length > MAX_VECTOR_DIMENSIONS) {
    throw new TypeError(`query_embedding must have between 1 and ${MAX_VECTOR_DIMENSIONS} dimensions`);
  }
  validateVector(query_embedding, query_embedding.length, 'query_embedding');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new TypeError('limit must be an integer between 1 and 100');
  }
}

function validateDocumentAndResult(document, result) {
  requireObject(document, 'document');
  requireObject(result, 'result');
  if (document.document_id !== result.document_id || !DOCUMENT_ID_PATTERN.test(document.document_id)) {
    throw new TypeError('document and result must refer to the same opaque document');
  }
  requireText(document.text, 'document.text');
  requireText(document.source_label, 'document.source_label');
  if (/[/\\\u0000-\u001f\u007f]/u.test(document.source_label) || document.source_label !== document.source_label.trim() || document.source_label.includes('..')) {
    throw new TypeError('document.source_label must be sanitized');
  }
  if (typeof document.source_hash !== 'string' || !HASH_PATTERN.test(document.source_hash)) {
    throw new TypeError('document.source_hash must be a lowercase SHA-256 hash');
  }
  requireObject(document.lineage, 'document.lineage');
  requireText(document.lineage.parser, 'document.lineage.parser');
  if (document.lineage.model !== null) requireText(document.lineage.model, 'document.lineage.model');
  if (typeof document.created_at !== 'string' || !RFC3339_PATTERN.test(document.created_at) || Number.isNaN(Date.parse(document.created_at))) {
    throw new TypeError('document.created_at must be RFC3339');
  }
  requireObject(document.retention, 'document.retention');
  if (typeof document.retention.owner_id !== 'string' || !OPAQUE_ID_PATTERN.test(document.retention.owner_id)) {
    throw new TypeError('document.retention.owner_id must be opaque');
  }
  if (!RETENTION_STATES.has(document.retention.state)) {
    throw new TypeError('document.retention.state is invalid');
  }
  if (result.source_hash !== document.source_hash || !Array.isArray(result.segments) || result.segments.length === 0) {
    throw new TypeError('result must contain the document source hash and segments');
  }
  for (const [index, segment] of result.segments.entries()) {
    requireObject(segment, `result.segments[${index}]`);
    requireText(segment.id, `result.segments[${index}].id`);
    if (segment.document_id !== document.document_id || segment.segment_index !== index) {
      throw new TypeError('segments must be ordered for the document');
    }
    requireText(segment.text, `result.segments[${index}].text`);
    if (!Number.isInteger(segment.start_offset) || !Number.isInteger(segment.end_offset) || segment.start_offset < 0 || segment.end_offset <= segment.start_offset) {
      throw new TypeError('segment offsets must be ordered non-negative integers');
    }
    if (typeof segment.text_sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(segment.text_sha256)) {
      throw new TypeError('segment.text_sha256 must be lowercase SHA-256 hex');
    }
    requireObject(segment.metadata, `result.segments[${index}].metadata`);
    requireObject(segment.provenance, `result.segments[${index}].provenance`);
    if (segment.provenance.segment_id !== segment.id || segment.provenance.source_hash !== document.source_hash) {
      throw new TypeError('segment provenance does not match the document');
    }
  }
}

function mapSegment(row) {
  return {
    id: row.segment_id,
    document_id: row.document_id,
    segment_index: row.segment_index,
    text: row.text,
    start_offset: row.start_offset,
    end_offset: row.end_offset,
    text_sha256: row.text_sha256,
    metadata: row.metadata,
    provenance: row.provenance
  };
}

function mapDocument(row, segments) {
  return {
    document_id: row.document_id,
    text: row.text,
    source_label: row.source_label,
    source_hash: row.source_hash,
    lineage: row.lineage,
    created_at: row.created_at,
    retention: {
      owner_id: row.owner_id,
      state: row.retention_state
    },
    segments
  };
}

function mapSearchResult(row) {
  return {
    ...mapSegment(row),
    source_hash: row.source_hash,
    source_label: row.source_label,
    owner_id: row.owner_id,
    retention_state: row.retention_state,
    rank: Number(row.rank)
  };
}

function mapSemanticSearchResult(row) {
  return {
    ...mapSegment(row),
    source_hash: row.source_hash,
    source_label: row.source_label,
    owner_id: row.owner_id,
    retention_state: row.retention_state,
    model_id: row.model_id,
    distance: Number(row.distance),
    score: Number(row.score)
  };
}

export function createStorage({ pool }) {
  requirePool(pool);

  return {
    async saveDocumentAndSegments(document, result) {
      validateDocumentAndResult(document, result);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const upsert = await client.query(`
          INSERT INTO documents (
            document_id, text, source_label, source_hash, lineage,
            created_at, owner_id, retention_state
          )
          VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
          ON CONFLICT (document_id) DO UPDATE SET
            text = EXCLUDED.text,
            source_label = EXCLUDED.source_label,
            source_hash = EXCLUDED.source_hash,
            lineage = EXCLUDED.lineage,
            created_at = EXCLUDED.created_at,
            owner_id = EXCLUDED.owner_id,
            retention_state = EXCLUDED.retention_state
          WHERE documents.owner_id = EXCLUDED.owner_id
        `, [
          document.document_id,
          document.text,
          document.source_label,
          document.source_hash,
          JSON.stringify(document.lineage),
          document.created_at,
          document.retention.owner_id,
          document.retention.state
        ]);
        if (upsert.rowCount !== 1) {
          throw new Error('document belongs to a different owner');
        }
        await client.query(`
          DELETE FROM segments AS s
          USING documents AS d
          WHERE s.document_id = d.document_id
            AND d.document_id = $1
            AND d.owner_id = $2
        `, [document.document_id, document.retention.owner_id]);

        for (const segment of result.segments) {
          await client.query(`
            INSERT INTO segments (
              id, document_id, segment_index, text, start_offset, end_offset,
              text_sha256, metadata, provenance
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
          `, [
            segment.id,
            segment.document_id,
            segment.segment_index,
            segment.text,
            segment.start_offset,
            segment.end_offset,
            segment.text_sha256,
            JSON.stringify(segment.metadata),
            JSON.stringify(segment.provenance)
          ]);
        }
        await client.query('COMMIT');
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Preserve the original database error.
        }
        throw error;
      } finally {
        client.release();
      }
    },

    async saveSegmentEmbeddings(input) {
      requireObject(input, 'input');
      const { document_id, owner_id, model_id, dimensions, embeddings, created_at } = input;
      validateSegmentEmbeddingsInput({ document_id, owner_id, model_id, dimensions, embeddings, created_at });

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const documentCheck = await client.query(`
          SELECT document_id
          FROM documents
          WHERE document_id = $1
            AND owner_id = $2
            AND retention_state = 'active'
          FOR UPDATE
        `, [document_id, owner_id]);
        if (documentCheck.rowCount !== 1) {
          throw new Error('document must belong to the owner and be active');
        }

        const segmentIds = embeddings.map(({ segment_id }) => segment_id);
        const segmentCheck = await client.query(`
          SELECT id
          FROM segments
          WHERE document_id = $1
            AND id = ANY($2::text[])
        `, [document_id, segmentIds]);
        if (segmentCheck.rowCount !== segmentIds.length) {
          throw new Error('every embedding segment must belong to the document');
        }

        const modelRows = await client.query(`
          SELECT dimensions
          FROM segment_embeddings
          WHERE model_id = $1
          FOR UPDATE
        `, [model_id]);
        if (modelRows.rows.some((row) => row.dimensions !== dimensions)) {
          throw new Error('model dimensions are inconsistent with existing embeddings');
        }

        await client.query(`
          DELETE FROM segment_embeddings AS e
          USING segments AS s
          WHERE e.segment_id = s.id
            AND s.document_id = $1
            AND e.model_id = $2
            AND NOT (e.segment_id = ANY($3::text[]))
        `, [document_id, model_id, segmentIds]);

        for (const embedding of embeddings) {
          await client.query(`
            INSERT INTO segment_embeddings (
              segment_id, model_id, dimensions, embedding, created_at
            )
            VALUES ($1, $2, $3, $4::vector, $5)
            ON CONFLICT (segment_id, model_id) DO UPDATE SET
              dimensions = EXCLUDED.dimensions,
              embedding = EXCLUDED.embedding,
              created_at = EXCLUDED.created_at
          `, [
            embedding.segment_id,
            model_id,
            dimensions,
            vectorLiteral(embedding.embedding),
            created_at
          ]);
        }
        await client.query('COMMIT');
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Preserve the original database error.
        }
        throw error;
      } finally {
        client.release();
      }
    },

    async searchSegmentsSemantic({ query_embedding, model_id, owner_id, limit = DEFAULT_SEARCH_LIMIT }) {
      validateQueryEmbedding({ query_embedding, model_id, owner_id, limit });

      const { rows } = await pool.query(`
        SELECT
          s.id AS segment_id, s.document_id, s.segment_index, s.text,
          s.start_offset, s.end_offset, s.text_sha256, s.metadata, s.provenance,
          d.source_hash, d.source_label, d.owner_id, d.retention_state,
          e.model_id,
          e.embedding <=> $1::vector AS distance,
          1 - (e.embedding <=> $1::vector) AS score
        FROM segment_embeddings AS e
        JOIN segments AS s ON s.id = e.segment_id
        JOIN documents AS d ON d.document_id = s.document_id
        WHERE d.owner_id = $3
          AND d.retention_state = 'active'
          AND e.model_id = $2
          AND e.dimensions = $4
        ORDER BY e.embedding <=> $1::vector ASC, s.document_id, s.segment_index, s.id
        LIMIT $5::integer
      `, [vectorLiteral(query_embedding), model_id, owner_id, query_embedding.length, limit]);
      return rows.map(mapSemanticSearchResult);
    },

    async searchSegmentsLexical({ query, owner_id, limit = DEFAULT_SEARCH_LIMIT }) {
      requireText(query, 'query');
      requireText(owner_id, 'owner_id');
      if (!Number.isInteger(limit) || limit <= 0) {
        throw new TypeError('limit must be a positive integer');
      }

      const { rows } = await pool.query(`
        SELECT
          s.id AS segment_id, s.document_id, s.segment_index, s.text,
          s.start_offset, s.end_offset, s.text_sha256, s.metadata, s.provenance,
          d.source_hash, d.source_label, d.owner_id, d.retention_state,
          ts_rank_cd(s.search_vector, plainto_tsquery('simple', $1)) AS rank
        FROM segments AS s
        JOIN documents AS d ON d.document_id = s.document_id
        WHERE d.owner_id = $2
          AND d.retention_state = 'active'
          AND s.search_vector @@ plainto_tsquery('simple', $1)
        ORDER BY rank DESC, s.document_id, s.segment_index
        LIMIT $3::integer
      `, [query, owner_id, limit]);
      return rows.map(mapSearchResult);
    },

    async getDocumentWithSegments(document_id, owner_id) {
      requireText(document_id, 'document_id');
      requireText(owner_id, 'owner_id');

      const { rows } = await pool.query(`
        SELECT document_id, text, source_label, source_hash, lineage,
               created_at, owner_id, retention_state
        FROM documents
        WHERE document_id = $1 AND owner_id = $2
      `, [document_id, owner_id]);
      if (rows.length === 0) return null;

      const segments = await pool.query(`
        SELECT s.id AS segment_id, s.document_id, s.segment_index, s.text,
               s.start_offset, s.end_offset, s.text_sha256, s.metadata, s.provenance
        FROM segments AS s
        JOIN documents AS d ON d.document_id = s.document_id
        WHERE s.document_id = $1 AND d.owner_id = $2
        ORDER BY s.segment_index
      `, [document_id, owner_id]);
      return mapDocument(rows[0], segments.rows.map(mapSegment));
    },

    async deleteDocument(document_id, owner_id) {
      requireText(document_id, 'document_id');
      requireText(owner_id, 'owner_id');

      const result = await pool.query(
        'DELETE FROM documents WHERE document_id = $1 AND owner_id = $2',
        [document_id, owner_id]
      );
      return result.rowCount === 1;
    }
  };
}
