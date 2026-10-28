import assert from 'node:assert/strict';
import test from 'node:test';
import { createStorage, segmentDocument } from '../../src/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;
const pg = databaseUrl ? (await import('pg')).default : null;
const pool = pg ? new pg.Pool({ connectionString: databaseUrl }) : null;

const document = {
  document_id: 'urn:document:postgres-synthetic',
  text: 'Lexical invoice search works. Provenance remains available.',
  source_label: 'synthetic-postgres-fixture.txt',
  source_hash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  lineage: { parser: 'synthetic-parser@1.0.0', model: null },
  created_at: '2026-01-01T00:00:00Z',
  retention: { owner_id: 'synthetic-owner-a', state: 'active' }
};
const result = segmentDocument(document, { max_segment_chars: 80 });

test('rejects malformed persistence input before connecting', async () => {
  const storage = createStorage({ pool: { connect() { throw new Error('database must not be contacted'); } } });

  await assert.rejects(
    storage.saveDocumentAndSegments({ ...document, document_id: '/private/source.pdf' }, result),
    /opaque document/
  );
  await assert.rejects(
    storage.saveDocumentAndSegments({ ...document, retention: { owner_id: '../other-owner', state: 'active' } }, result),
    /owner_id/
  );
});

async function removeDocument(documentId, ownerId) {
  await pool.query('DELETE FROM documents WHERE document_id = $1 AND owner_id = $2', [documentId, ownerId]);
}

if (pool) {
  test.after(async () => pool.end());
}

integrationTest('stores and reads the complete segmented document contract', async () => {
  const storage = createStorage({ pool });
  await removeDocument(document.document_id, document.retention.owner_id);

  await storage.saveDocumentAndSegments(document, result);
  const stored = await storage.getDocumentWithSegments(document.document_id, document.retention.owner_id);

  assert.deepEqual(stored, { ...document, segments: result.segments });
  await removeDocument(document.document_id, document.retention.owner_id);
});

integrationTest('rejects cross-owner replacement and preserves the original document', async () => {
  const storage = createStorage({ pool });
  const guardedDocument = {
    ...document,
    document_id: 'urn:document:postgres-owner-guard',
    retention: { owner_id: 'synthetic-owner-guard', state: 'active' }
  };
  const guardedResult = segmentDocument(guardedDocument, { max_segment_chars: 80 });
  const hostileDocument = {
    ...guardedDocument,
    retention: { owner_id: 'synthetic-owner-hostile', state: 'active' }
  };

  await removeDocument(guardedDocument.document_id, guardedDocument.retention.owner_id);
  await storage.saveDocumentAndSegments(guardedDocument, guardedResult);

  await assert.rejects(
    storage.saveDocumentAndSegments(hostileDocument, segmentDocument(hostileDocument, { max_segment_chars: 80 })),
    /owner/
  );
  assert.deepEqual(
    await storage.getDocumentWithSegments(guardedDocument.document_id, guardedDocument.retention.owner_id),
    { ...guardedDocument, segments: guardedResult.segments }
  );
  assert.equal(await storage.getDocumentWithSegments(guardedDocument.document_id, hostileDocument.retention.owner_id), null);

  await removeDocument(guardedDocument.document_id, guardedDocument.retention.owner_id);
});

integrationTest('searches lexical matches with owner isolation and active retention', async () => {
  const storage = createStorage({ pool });
  const otherDocument = {
    ...document,
    document_id: 'urn:document:postgres-other-owner',
    retention: { owner_id: 'synthetic-owner-b', state: 'active' }
  };
  const tombstoneDocument = {
    ...document,
    document_id: 'urn:document:postgres-tombstone',
    retention: { owner_id: 'synthetic-owner-c', state: 'tombstone' }
  };

  await Promise.all([
    removeDocument(document.document_id, document.retention.owner_id),
    removeDocument(otherDocument.document_id, otherDocument.retention.owner_id),
    removeDocument(tombstoneDocument.document_id, tombstoneDocument.retention.owner_id)
  ]);
  await storage.saveDocumentAndSegments(document, result);
  await storage.saveDocumentAndSegments(otherDocument, segmentDocument(otherDocument, { max_segment_chars: 80 }));
  await storage.saveDocumentAndSegments(tombstoneDocument, segmentDocument(tombstoneDocument, { max_segment_chars: 80 }));

  const matches = await storage.searchSegmentsLexical({ query: 'invoice', owner_id: document.retention.owner_id, limit: 10 });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].document_id, document.document_id);
  assert.equal(matches[0].provenance.citation.ref, result.segments[0].provenance.citation.ref);
  assert.equal((await storage.searchSegmentsLexical({ query: 'invoice', owner_id: otherDocument.retention.owner_id, limit: 10 })).length, 1);
  assert.equal((await storage.searchSegmentsLexical({ query: 'invoice', owner_id: tombstoneDocument.retention.owner_id, limit: 10 })).length, 0);

  assert.equal(await storage.getDocumentWithSegments(document.document_id, otherDocument.retention.owner_id), null);
  assert.equal(await storage.deleteDocument(document.document_id, otherDocument.retention.owner_id), false);

  await removeDocument(document.document_id, document.retention.owner_id);
  await removeDocument(otherDocument.document_id, otherDocument.retention.owner_id);
  await removeDocument(tombstoneDocument.document_id, tombstoneDocument.retention.owner_id);
});

integrationTest('replaces atomically and cascades document deletion', async () => {
  const storage = createStorage({ pool });
  await removeDocument(document.document_id, document.retention.owner_id);
  await storage.saveDocumentAndSegments(document, result);
  await storage.saveDocumentAndSegments(document, result);
  assert.deepEqual(await storage.getDocumentWithSegments(document.document_id, document.retention.owner_id), { ...document, segments: result.segments });

  const broken = {
    ...result,
    segments: [result.segments[0], { ...result.segments[1], id: result.segments[0].id }]
  };
  await assert.rejects(storage.saveDocumentAndSegments(document, broken));
  assert.deepEqual(await storage.getDocumentWithSegments(document.document_id, document.retention.owner_id), { ...document, segments: result.segments });

  assert.equal(await storage.deleteDocument(document.document_id, document.retention.owner_id), true);
  assert.equal(await storage.getDocumentWithSegments(document.document_id, document.retention.owner_id), null);
  const childRows = await pool.query('SELECT count(*)::int AS count FROM segments WHERE document_id = $1', [document.document_id]);
  assert.equal(childRows.rows[0].count, 0);
});
