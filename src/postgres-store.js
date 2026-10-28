const DEFAULT_SEARCH_LIMIT = 20;

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

export function createStorage({ pool }) {
  requirePool(pool);

  return {
    async saveDocumentAndSegments(document, result) {
      if (!document || !result || document.document_id !== result.document_id) {
        throw new TypeError('document and result must refer to the same document');
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`
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
        await client.query('DELETE FROM segments WHERE document_id = $1', [document.document_id]);

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
        SELECT id AS segment_id, document_id, segment_index, text,
               start_offset, end_offset, text_sha256, metadata, provenance
        FROM segments
        WHERE document_id = $1
        ORDER BY segment_index
      `, [document_id]);
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
