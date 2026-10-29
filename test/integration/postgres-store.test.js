import assert from 'node:assert/strict';
import test from 'node:test';
import { createStorage, resolveCitations, segmentDocument } from '../../src/index.js';

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
const semanticDocument = {
  ...document,
  document_id: 'urn:document:postgres-semantic',
  text: 'alpha invoice text.\n\nbeta contract text.\n\ngamma retention text.',
  source_hash: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  source_label: 'synthetic-semantic-fixture.txt'
};
const semanticResult = segmentDocument(semanticDocument, { max_segment_chars: 100 });
const hybridDocument = {
  ...document,
  document_id: 'urn:document:postgres-hybrid',
  text: 'invoice contract alpha.\n\ncontract beta.\n\nretention gamma.',
  source_hash: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  source_label: 'synthetic-hybrid-fixture.txt',
  retention: { owner_id: 'synthetic-hybrid-owner-a', state: 'active' }
};
const hybridResult = segmentDocument(hybridDocument, { max_segment_chars: 100 });
const semanticVectors3d = [
  [1, 0, 0],
  [0, 1, 0],
  [0.7, 0.7, 0]
];
const semanticVectors4d = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0]
];

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

test('rejects malformed semantic input before connecting', async () => {
  let contacts = 0;
  const storage = createStorage({
    pool: {
      connect() {
        contacts += 1;
        throw new Error('database must not be contacted');
      },
      query() {
        contacts += 1;
        throw new Error('database must not be contacted');
      }
    }
  });
  const valid = {
    document_id: document.document_id,
    owner_id: document.retention.owner_id,
    model_id: 'synthetic-3d',
    dimensions: 3,
    embeddings: [{ segment_id: result.segments[0].id, embedding: [1, 0, 0] }],
    created_at: document.created_at
  };

  await assert.rejects(storage.registerEmbeddingModel({ model_id: '../model', dimensions: 3 }), /model_id/);
  await assert.rejects(storage.registerEmbeddingModel({ model_id: 'synthetic-3d', dimensions: 0 }), /dimensions/);
  await assert.rejects(storage.registerEmbeddingModel({ model_id: 'synthetic-3d', dimensions: 3, status: 'unknown' }), /status/);
  await assert.rejects(storage.getEmbeddingModel('../model'), /model_id/);
  await assert.rejects(storage.inspectEmbeddingCoverage({ model_id: '../model', owner_id: document.retention.owner_id }), /model_id/);
  await assert.rejects(storage.inspectEmbeddingCoverage({ model_id: 'synthetic-3d', owner_id: '../owner' }), /owner_id/);
  await assert.rejects(storage.saveSegmentEmbeddings({ ...valid, dimensions: 0 }), /dimensions/);
  await assert.rejects(storage.saveSegmentEmbeddings({ ...valid, model_id: '../model' }), /model_id/);
  await assert.rejects(storage.saveSegmentEmbeddings({ ...valid, embeddings: [valid.embeddings[0], valid.embeddings[0]] }), /duplicate/);
  await assert.rejects(storage.saveSegmentEmbeddings({ ...valid, embeddings: [{ ...valid.embeddings[0], embedding: [1, 0] }] }), /dimension/);
  await assert.rejects(storage.saveSegmentEmbeddings({ ...valid, embeddings: [{ ...valid.embeddings[0], embedding: [0, 0, 0] }] }), /non-zero/);
  await assert.rejects(storage.saveSegmentEmbeddings({ ...valid, embeddings: [{ ...valid.embeddings[0], embedding: [1, Number.NaN, 0] }] }), /finite/);
  await assert.rejects(storage.searchSegmentsSemantic({ query_embedding: [1, 0, 0], model_id: 'synthetic-3d', owner_id: document.retention.owner_id, limit: 101 }), /limit/);
  await assert.rejects(storage.searchSegmentsSemantic({ query_embedding: [0, 0, 0], model_id: 'synthetic-3d', owner_id: document.retention.owner_id, limit: 1 }), /non-zero/);
  await assert.rejects(
    storage.searchSegmentsHybrid({
      query: 'invoice',
      query_embedding: [1, 0, 0],
      model_id: 'synthetic-3d',
      owner_id: document.retention.owner_id,
      limit: 1,
      rrf_k: 0
    }),
    /rrf_k/
  );
  await assert.rejects(
    storage.searchSegmentsHybrid({
      query: 'invoice',
      query_embedding: [1, 0, 0],
      model_id: 'synthetic-3d',
      owner_id: document.retention.owner_id,
      limit: 101
    }),
    /limit/
  );
  await assert.rejects(
    storage.revalidateCitations([], { owner_id: document.retention.owner_id }),
    /non-empty/
  );
  await assert.rejects(
    storage.revalidateCitations([{}], { owner_id: '../other-owner' }),
    /owner_id/
  );
  await assert.rejects(
    storage.revalidateCitations(Array.from({ length: 101 }, () => ({})), { owner_id: document.retention.owner_id }),
    /100/
  );
  await assert.rejects(
    storage.searchSegmentsLexical({ query: 'invoice', owner_id: '../other-owner', limit: 1 }),
    /opaque/
  );
  await assert.rejects(
    storage.searchSegmentsLexical({ query: 'invoice', owner_id: document.retention.owner_id, limit: 0 }),
    /100/
  );
  await assert.rejects(
    storage.searchSegmentsLexical({ query: 'invoice', owner_id: document.retention.owner_id, limit: 1.5 }),
    /100/
  );
  await assert.rejects(
    storage.searchSegmentsLexical({ query: 'invoice', owner_id: document.retention.owner_id, limit: 101 }),
    /100/
  );
  assert.equal(contacts, 0);
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
    removeDocument(tombstoneDocument.document_id, tombstoneDocument.retention.owner_id),
    removeDocument(semanticDocument.document_id, semanticDocument.retention.owner_id),
    removeDocument('urn:document:postgres-semantic-other', 'synthetic-owner-b'),
    removeDocument('urn:document:postgres-semantic-tombstone', 'synthetic-owner-c')
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

integrationTest('stores exact model-scoped cosine results and replaces embeddings deterministically', async () => {
  const storage = createStorage({ pool });
  await removeDocument(semanticDocument.document_id, semanticDocument.retention.owner_id);
  await storage.saveDocumentAndSegments(semanticDocument, semanticResult);

  await storage.saveSegmentEmbeddings({
    document_id: semanticDocument.document_id,
    owner_id: semanticDocument.retention.owner_id,
    model_id: 'synthetic-3d',
    dimensions: 3,
    embeddings: semanticResult.segments.map((segment, index) => ({ segment_id: segment.id, embedding: semanticVectors3d[index] })),
    created_at: semanticDocument.created_at
  });
  await storage.saveSegmentEmbeddings({
    document_id: semanticDocument.document_id,
    owner_id: semanticDocument.retention.owner_id,
    model_id: 'synthetic-4d',
    dimensions: 4,
    embeddings: semanticResult.segments.map((segment, index) => ({ segment_id: segment.id, embedding: semanticVectors4d[index] })),
    created_at: semanticDocument.created_at
  });
  await assert.rejects(
    storage.saveSegmentEmbeddings({
      document_id: semanticDocument.document_id,
      owner_id: semanticDocument.retention.owner_id,
      model_id: 'synthetic-3d',
      dimensions: 4,
      embeddings: semanticResult.segments.map((segment, index) => ({ segment_id: segment.id, embedding: semanticVectors4d[index] })),
      created_at: semanticDocument.created_at
    }),
    /inconsistent/
  );

  const matches = await storage.searchSegmentsSemantic({
    query_embedding: [1, 0, 0],
    model_id: 'synthetic-3d',
    owner_id: semanticDocument.retention.owner_id,
    limit: 3
  });
  assert.deepEqual(matches.map((match) => match.segment_index), [0, 2, 1]);
  assert.equal(matches[0].model_id, 'synthetic-3d');
  assert.equal(matches[0].distance, 0);
  assert.equal(matches[0].score, 1);
  assert.ok(Math.abs(matches[1].score - Math.SQRT1_2) < 0.0001);
  assert.equal(matches[0].provenance.segment_id, matches[0].id);

  await storage.saveSegmentEmbeddings({
    document_id: semanticDocument.document_id,
    owner_id: semanticDocument.retention.owner_id,
    model_id: 'synthetic-3d',
    dimensions: 3,
    embeddings: semanticResult.segments.map((segment, index) => ({
      segment_id: segment.id,
      embedding: index === 1 ? [1, 0, 0] : semanticVectors3d[index]
    })),
    created_at: '2026-01-02T00:00:00Z'
  });
  const replaced = await storage.searchSegmentsSemantic({
    query_embedding: [1, 0, 0],
    model_id: 'synthetic-3d',
    owner_id: semanticDocument.retention.owner_id,
    limit: 3
  });
  assert.deepEqual(replaced.slice(0, 2).map((match) => match.segment_index), [0, 1]);

  await removeDocument(semanticDocument.document_id, semanticDocument.retention.owner_id);
});

integrationTest('registers global models and reports owner-scoped partial coverage', async () => {
  const storage = createStorage({ pool });
  const coverageModel = 'coverage-3d';
  const mismatchModel = 'coverage-mismatch';
  await pool.query('DELETE FROM embedding_models WHERE model_id = ANY($1::text[])', [[coverageModel, mismatchModel]]);
  await removeDocument(semanticDocument.document_id, semanticDocument.retention.owner_id);
  await storage.saveDocumentAndSegments(semanticDocument, semanticResult);

  assert.deepEqual(
    await Promise.all([
      storage.registerEmbeddingModel({ model_id: coverageModel, dimensions: 3 }),
      storage.registerEmbeddingModel({ model_id: coverageModel, dimensions: 3 })
    ]),
    [
      { model_id: coverageModel, dimensions: 3, status: 'active' },
      { model_id: coverageModel, dimensions: 3, status: 'active' }
    ]
  );
  await assert.rejects(
    storage.registerEmbeddingModel({ model_id: coverageModel, dimensions: 4 }),
    /conflicts/
  );
  assert.deepEqual(await storage.getEmbeddingModel(coverageModel), { model_id: coverageModel, dimensions: 3, status: 'active' });

  await storage.saveSegmentEmbeddings({
    document_id: semanticDocument.document_id,
    owner_id: semanticDocument.retention.owner_id,
    model_id: coverageModel,
    dimensions: 3,
    embeddings: [{ segment_id: semanticResult.segments[0].id, embedding: semanticVectors3d[0] }],
    created_at: semanticDocument.created_at
  });
  assert.deepEqual(
    await storage.inspectEmbeddingCoverage({ model_id: coverageModel, owner_id: semanticDocument.retention.owner_id }),
    {
      model_id: coverageModel,
      owner_id: semanticDocument.retention.owner_id,
      status: 'active',
      dimensions: 3,
      total_segments: 3,
      embedded_segments: 1,
      missing_segments: 2,
      dimension_mismatch_segments: 0
    }
  );

  assert.deepEqual(
    await storage.registerEmbeddingModel({ model_id: mismatchModel, dimensions: 4 }),
    { model_id: mismatchModel, dimensions: 4, status: 'active' }
  );
  await storage.saveSegmentEmbeddings({
    document_id: semanticDocument.document_id,
    owner_id: semanticDocument.retention.owner_id,
    model_id: mismatchModel,
    dimensions: 3,
    embeddings: [{ segment_id: semanticResult.segments[1].id, embedding: semanticVectors3d[1] }],
    created_at: semanticDocument.created_at
  });
  assert.deepEqual(
    await storage.inspectEmbeddingCoverage({ model_id: mismatchModel, owner_id: semanticDocument.retention.owner_id }),
    {
      model_id: mismatchModel,
      owner_id: semanticDocument.retention.owner_id,
      status: 'active',
      dimensions: 4,
      total_segments: 3,
      embedded_segments: 0,
      missing_segments: 2,
      dimension_mismatch_segments: 1
    }
  );

  assert.deepEqual(
    await Promise.all([
      storage.registerEmbeddingModel({ model_id: coverageModel, dimensions: 3, status: 'deprecated' }),
      storage.registerEmbeddingModel({ model_id: coverageModel, dimensions: 3, status: 'deprecated' })
    ]),
    [
      { model_id: coverageModel, dimensions: 3, status: 'deprecated' },
      { model_id: coverageModel, dimensions: 3, status: 'deprecated' }
    ]
  );
  await assert.rejects(
    storage.registerEmbeddingModel({ model_id: coverageModel, dimensions: 3 }),
    /reactivated/
  );
  assert.deepEqual(
    (await storage.listEmbeddingModels()).map(({ model_id }) => model_id),
    [coverageModel, mismatchModel]
  );

  await pool.query(
    "UPDATE documents SET retention_state = 'tombstone' WHERE document_id = $1 AND owner_id = $2",
    [semanticDocument.document_id, semanticDocument.retention.owner_id]
  );
  assert.deepEqual(
    await storage.inspectEmbeddingCoverage({ model_id: coverageModel, owner_id: semanticDocument.retention.owner_id }),
    {
      model_id: coverageModel,
      owner_id: semanticDocument.retention.owner_id,
      status: 'deprecated',
      dimensions: 3,
      total_segments: 0,
      embedded_segments: 0,
      missing_segments: 0,
      dimension_mismatch_segments: 0
    }
  );
  await removeDocument(semanticDocument.document_id, semanticDocument.retention.owner_id);
});

integrationTest('isolates semantic results by owner, active retention, model, and cascades twice', async () => {
  const storage = createStorage({ pool });
  const otherDocument = { ...semanticDocument, document_id: 'urn:document:postgres-semantic-other', retention: { owner_id: 'synthetic-owner-b', state: 'active' } };
  const tombstoneDocument = { ...semanticDocument, document_id: 'urn:document:postgres-semantic-tombstone', retention: { owner_id: 'synthetic-owner-c', state: 'active' } };
  const otherResult = segmentDocument(otherDocument, { max_segment_chars: 100 });
  const tombstoneResult = segmentDocument(tombstoneDocument, { max_segment_chars: 100 });
  await Promise.all([
    removeDocument(semanticDocument.document_id, semanticDocument.retention.owner_id),
    removeDocument(otherDocument.document_id, otherDocument.retention.owner_id),
    removeDocument(tombstoneDocument.document_id, tombstoneDocument.retention.owner_id)
  ]);
  await Promise.all([
    storage.saveDocumentAndSegments(semanticDocument, semanticResult),
    storage.saveDocumentAndSegments(otherDocument, otherResult),
    storage.saveDocumentAndSegments(tombstoneDocument, tombstoneResult)
  ]);
  const save = (doc, segmentResult, modelId = 'synthetic-3d') => storage.saveSegmentEmbeddings({
    document_id: doc.document_id,
    owner_id: doc.retention.owner_id,
    model_id: modelId,
    dimensions: 3,
    embeddings: segmentResult.segments.map((segment) => ({ segment_id: segment.id, embedding: [1, 0, 0] })),
    created_at: doc.created_at
  });
  await Promise.all([
    save(semanticDocument, semanticResult),
    save(otherDocument, otherResult),
    save(tombstoneDocument, tombstoneResult)
  ]);
  await pool.query(
    "UPDATE documents SET retention_state = 'tombstone' WHERE document_id = $1 AND owner_id = $2",
    [tombstoneDocument.document_id, tombstoneDocument.retention.owner_id]
  );

  assert.equal((await storage.searchSegmentsSemantic({ query_embedding: [1, 0, 0], model_id: 'synthetic-3d', owner_id: semanticDocument.retention.owner_id, limit: 100 })).length, 3);
  assert.equal((await storage.searchSegmentsSemantic({ query_embedding: [1, 0, 0], model_id: 'synthetic-3d', owner_id: otherDocument.retention.owner_id, limit: 100 })).length, 3);
  assert.equal((await storage.searchSegmentsSemantic({ query_embedding: [1, 0, 0], model_id: 'synthetic-3d', owner_id: tombstoneDocument.retention.owner_id, limit: 100 })).length, 0);
  assert.equal((await storage.searchSegmentsSemantic({ query_embedding: [1, 0, 0], model_id: 'synthetic-4d', owner_id: semanticDocument.retention.owner_id, limit: 100 })).length, 0);

  await storage.deleteDocument(semanticDocument.document_id, semanticDocument.retention.owner_id);
  const firstCascade = await pool.query('SELECT count(*)::int AS count FROM segment_embeddings WHERE segment_id LIKE $1', ['urn:segment:urn:document:postgres-semantic-%']);
  assert.equal(firstCascade.rows[0].count, 6);
  await storage.deleteDocument(otherDocument.document_id, otherDocument.retention.owner_id);
  await storage.deleteDocument(tombstoneDocument.document_id, tombstoneDocument.retention.owner_id);
  const secondCascade = await pool.query('SELECT count(*)::int AS count FROM segment_embeddings WHERE segment_id LIKE $1', ['urn:segment:urn:document:postgres-semantic-%']);
  assert.equal(secondCascade.rows[0].count, 0);
});

integrationTest('fuses lexical and semantic matches with deterministic isolation and provenance', async () => {
  const storage = createStorage({ pool });
  const otherDocument = {
    ...hybridDocument,
    document_id: 'urn:document:postgres-hybrid-other',
    source_hash: 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    source_label: 'synthetic-hybrid-other.txt',
    retention: { owner_id: 'synthetic-hybrid-owner-b', state: 'active' }
  };
  const tombstoneDocument = {
    ...hybridDocument,
    document_id: 'urn:document:postgres-hybrid-tombstone',
    source_hash: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    source_label: 'synthetic-hybrid-tombstone.txt',
    retention: { owner_id: 'synthetic-hybrid-owner-c', state: 'active' }
  };
  const purgedDocument = {
    ...hybridDocument,
    document_id: 'urn:document:postgres-hybrid-purged',
    source_hash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    source_label: 'synthetic-hybrid-purged.txt',
    retention: { owner_id: 'synthetic-hybrid-owner-d', state: 'active' }
  };
  const otherResult = segmentDocument(otherDocument, { max_segment_chars: 100 });
  const tombstoneResult = segmentDocument(tombstoneDocument, { max_segment_chars: 100 });
  const purgedResult = segmentDocument(purgedDocument, { max_segment_chars: 100 });
  const documents = [hybridDocument, otherDocument, tombstoneDocument, purgedDocument];
  await Promise.all(documents.map((entry) => removeDocument(entry.document_id, entry.retention.owner_id)));
  await Promise.all([
    storage.saveDocumentAndSegments(hybridDocument, hybridResult),
    storage.saveDocumentAndSegments(otherDocument, otherResult),
    storage.saveDocumentAndSegments(tombstoneDocument, tombstoneResult),
    storage.saveDocumentAndSegments(purgedDocument, purgedResult)
  ]);
  const saveEmbeddings = (entry, entryResult) => storage.saveSegmentEmbeddings({
    document_id: entry.document_id,
    owner_id: entry.retention.owner_id,
    model_id: 'hybrid-3d',
    dimensions: 3,
    embeddings: [
      { segment_id: entryResult.segments[0].id, embedding: [1, 0, 0] },
      { segment_id: entryResult.segments[2].id, embedding: [0, 1, 0] }
    ],
    created_at: entry.created_at
  });
  await Promise.all([
    saveEmbeddings(hybridDocument, hybridResult),
    saveEmbeddings(otherDocument, otherResult),
    saveEmbeddings(tombstoneDocument, tombstoneResult),
    saveEmbeddings(purgedDocument, purgedResult)
  ]);
  await pool.query(
    "UPDATE documents SET retention_state = 'tombstone' WHERE document_id = $1 AND owner_id = $2",
    [tombstoneDocument.document_id, tombstoneDocument.retention.owner_id]
  );
  await pool.query(
    "UPDATE documents SET retention_state = 'purged' WHERE document_id = $1 AND owner_id = $2",
    [purgedDocument.document_id, purgedDocument.retention.owner_id]
  );

  const request = {
    query: 'contract',
    query_embedding: [1, 0, 0],
    model_id: 'hybrid-3d',
    owner_id: hybridDocument.retention.owner_id,
    limit: 3,
    rrf_k: 60
  };
  const matches = await storage.searchSegmentsHybrid(request);
  assert.deepEqual(matches.map((match) => match.segment_index), [0, 1, 2]);
  assert.deepEqual(matches.map((match) => [match.lexical_rank, match.semantic_rank]), [[1, 1], [2, null], [null, 2]]);
  assert.ok(Math.abs(matches[0].hybrid_score - 2 / 61) < 0.000001);
  assert.ok(Math.abs(matches[1].hybrid_score - 1 / 62) < 0.000001);
  assert.equal(matches[0].provenance.citation.ref, hybridResult.segments[0].provenance.citation.ref);
  assert.deepEqual(await storage.searchSegmentsHybrid(request), matches);
  assert.deepEqual(
    (await storage.searchSegmentsHybrid({ ...request, owner_id: otherDocument.retention.owner_id })).map((match) => match.document_id),
    [otherDocument.document_id, otherDocument.document_id, otherDocument.document_id]
  );
  assert.equal((await storage.searchSegmentsHybrid({ ...request, owner_id: tombstoneDocument.retention.owner_id })).length, 0);
  assert.equal((await storage.searchSegmentsHybrid({ ...request, owner_id: purgedDocument.retention.owner_id })).length, 0);
  assert.deepEqual(
    (await storage.searchSegmentsHybrid({ ...request, query_embedding: [1, 0, 0, 0], model_id: 'hybrid-4d' })).map((match) => match.semantic_rank),
    [null, null]
  );

  await Promise.all(documents.map((entry) => removeDocument(entry.document_id, entry.retention.owner_id)));
});

integrationTest('revalidates citation freshness across ownership, retention, deletion, and re-ingestion', async () => {
  const storage = createStorage({ pool });
  await removeDocument(hybridDocument.document_id, hybridDocument.retention.owner_id);
  await storage.saveDocumentAndSegments(hybridDocument, hybridResult);

  const matches = await storage.searchSegmentsLexical({
    query: 'contract',
    owner_id: hybridDocument.retention.owner_id,
    limit: 2
  });
  const citations = resolveCitations(matches, { owner_id: hybridDocument.retention.owner_id });
  assert.deepEqual(
    await storage.revalidateCitations(citations, { owner_id: hybridDocument.retention.owner_id }),
    { valid: true, stale_ids: [] }
  );

  const mixedCitations = [
    citations[0],
    { ...citations[1], segment_id: 'missing-segment-1' },
    citations[1],
    { ...citations[0], segment_id: 'missing-segment-2' }
  ];
  assert.deepEqual(
    await storage.revalidateCitations(mixedCitations, { owner_id: hybridDocument.retention.owner_id }),
    { valid: false, stale_ids: ['missing-segment-1', 'missing-segment-2'] }
  );

  assert.deepEqual(
    await storage.revalidateCitations(citations, { owner_id: 'synthetic-hybrid-owner-b' }),
    { valid: false, stale_ids: citations.map((citation) => citation.segment_id) }
  );

  await pool.query(
    "UPDATE documents SET retention_state = 'tombstone' WHERE document_id = $1 AND owner_id = $2",
    [hybridDocument.document_id, hybridDocument.retention.owner_id]
  );
  assert.deepEqual(
    await storage.revalidateCitations(citations, { owner_id: hybridDocument.retention.owner_id }),
    { valid: false, stale_ids: citations.map((citation) => citation.segment_id) }
  );
  await pool.query(
    "UPDATE documents SET retention_state = 'purged' WHERE document_id = $1 AND owner_id = $2",
    [hybridDocument.document_id, hybridDocument.retention.owner_id]
  );
  assert.deepEqual(
    await storage.revalidateCitations(citations, { owner_id: hybridDocument.retention.owner_id }),
    { valid: false, stale_ids: citations.map((citation) => citation.segment_id) }
  );

  await pool.query(
    "UPDATE documents SET retention_state = 'active' WHERE document_id = $1 AND owner_id = $2",
    [hybridDocument.document_id, hybridDocument.retention.owner_id]
  );
  const changedDocument = {
    ...hybridDocument,
    text: 'contract replacement only.',
    source_hash: 'sha256:9999999999999999999999999999999999999999999999999999999999999999'
  };
  await storage.saveDocumentAndSegments(changedDocument, segmentDocument(changedDocument, { max_segment_chars: 100 }));
  assert.deepEqual(
    await storage.revalidateCitations(citations, { owner_id: hybridDocument.retention.owner_id }),
    { valid: false, stale_ids: citations.map((citation) => citation.segment_id) }
  );

  await storage.deleteDocument(hybridDocument.document_id, hybridDocument.retention.owner_id);
  assert.deepEqual(
    await storage.revalidateCitations(citations, { owner_id: hybridDocument.retention.owner_id }),
    { valid: false, stale_ids: citations.map((citation) => citation.segment_id) }
  );
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
