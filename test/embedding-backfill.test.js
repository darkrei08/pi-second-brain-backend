import assert from 'node:assert/strict';
import test from 'node:test';

import { runEmbeddingBackfill } from '../src/index.js';

const modelId = 'backfill-3d';
const ownerId = 'synthetic-worker-owner-a';
const createdAt = '2026-01-01T00:00:00Z';
const texts = ['alpha one.', 'beta two.', 'gamma three.'];

function createDocument(documentId, documentTexts = texts) {
  return {
    document_id: documentId,
    created_at: createdAt,
    retention: { owner_id: ownerId, state: 'active' },
    segments: documentTexts.map((text, index) => ({ id: `${documentId}-segment-${index}`, text }))
  };
}

function createPlan(documents, { model_id = modelId, owner_id = ownerId, dimensions = 3 } = {}) {
  return {
    model_id,
    owner_id,
    status: 'active',
    dimensions,
    documents: documents.map(({ document_id, segment_ids }) => ({
      document_id,
      segment_ids,
      missing_segment_ids: segment_ids,
      dimension_mismatch_segment_ids: []
    }))
  };
}

function createFakeStorage({ plan, documents = {}, onSave } = {}) {
  const calls = { plan: [], read: [], save: [] };
  return {
    calls,
    async listEmbeddingBackfill(input) {
      calls.plan.push(input);
      return plan;
    },
    async getDocumentWithSegments(document_id, owner_id) {
      calls.read.push({ document_id, owner_id });
      return documents[document_id] ?? null;
    },
    async saveSegmentEmbeddings(input) {
      calls.save.push(input);
      if (onSave) await onSave(input, calls.save.length);
    }
  };
}

function createEmbed(vectors = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
  const calls = [];
  const embed = async (input) => {
    calls.push(input);
    return vectors.slice(0, input.inputs.length);
  };
  embed.calls = calls;
  return embed;
}

test('rejects malformed worker input before reading the plan', async () => {
  await assert.rejects(runEmbeddingBackfill(), /input must be an object/);
  await assert.rejects(
    runEmbeddingBackfill({ storage: {}, embed: async () => [], model_id: modelId, owner_id: ownerId }),
    /storage must provide listEmbeddingBackfill/
  );
  await assert.rejects(
    runEmbeddingBackfill({ storage: createFakeStorage(), embed: 'nope', model_id: modelId, owner_id: ownerId }),
    /embed must be a function/
  );
  await assert.rejects(
    runEmbeddingBackfill({ storage: createFakeStorage(), embed: createEmbed(), model_id: '/private/model', owner_id: ownerId }),
    /model_id must be opaque/
  );
  await assert.rejects(
    runEmbeddingBackfill({ storage: createFakeStorage(), embed: createEmbed(), model_id: modelId, owner_id: '../other' }),
    /owner_id must be opaque/
  );
  await assert.rejects(
    runEmbeddingBackfill({ storage: createFakeStorage(), embed: createEmbed(), model_id: modelId, owner_id: ownerId, limit: 101 }),
    /limit must be an integer between 1 and 100/
  );
});

test('embeds and writes one planned document with its complete segment set', async () => {
  const document = createDocument('urn:document:worker-one');
  const segmentIds = document.segments.map(({ id }) => id);
  const storage = createFakeStorage({
    plan: createPlan([{ document_id: document.document_id, segment_ids: segmentIds }]),
    documents: { [document.document_id]: document }
  });
  const embed = createEmbed();

  const result = await runEmbeddingBackfill({ storage, embed, model_id: modelId, owner_id: ownerId, limit: 5 });

  assert.deepEqual(storage.calls.plan, [{ model_id: modelId, owner_id: ownerId, limit: 5 }]);
  assert.deepEqual(storage.calls.read, [{ document_id: document.document_id, owner_id: ownerId }]);
  assert.deepEqual(embed.calls, [{ model_id: modelId, dimensions: 3, inputs: texts }]);
  assert.deepEqual(storage.calls.save, [{
    document_id: document.document_id,
    owner_id: ownerId,
    model_id: modelId,
    dimensions: 3,
    embeddings: [
      { segment_id: segmentIds[0], embedding: [1, 0, 0] },
      { segment_id: segmentIds[1], embedding: [0, 1, 0] },
      { segment_id: segmentIds[2], embedding: [0, 0, 1] }
    ],
    created_at: createdAt
  }]);
  assert.deepEqual(result, {
    model_id: modelId,
    owner_id: ownerId,
    dimensions: 3,
    processed_documents: 1,
    embedded_segments: 3,
    skipped_documents: []
  });
});

test('returns zero counters and never embeds when the plan is empty', async () => {
  const storage = createFakeStorage({ plan: createPlan([]) });
  const embed = createEmbed();

  assert.deepEqual(await runEmbeddingBackfill({ storage, embed, model_id: modelId, owner_id: ownerId }), {
    model_id: modelId,
    owner_id: ownerId,
    dimensions: 3,
    processed_documents: 0,
    embedded_segments: 0,
    skipped_documents: []
  });
  assert.deepEqual(storage.calls.plan, [{ model_id: modelId, owner_id: ownerId, limit: 20 }]);
  assert.deepEqual(embed.calls, []);
  assert.deepEqual(storage.calls.save, []);
});

test('skips a document that left active retention after the plan was read', async () => {
  const document = createDocument('urn:document:worker-tombstoned');
  const tombstoned = { ...document, retention: { owner_id: ownerId, state: 'tombstone' } };
  const storage = createFakeStorage({
    plan: createPlan([{ document_id: document.document_id, segment_ids: document.segments.map(({ id }) => id) }]),
    documents: { [document.document_id]: tombstoned }
  });
  const embed = createEmbed();

  const result = await runEmbeddingBackfill({ storage, embed, model_id: modelId, owner_id: ownerId });

  assert.deepEqual(result.skipped_documents, [
    { document_id: document.document_id, reason: 'document is not active' }
  ]);
  assert.equal(result.processed_documents, 0);
  assert.deepEqual(embed.calls, []);
  assert.deepEqual(storage.calls.save, []);
});

test('skips unreadable and changed documents in plan order without writing them', async () => {
  const changed = createDocument('urn:document:worker-changed');
  const stale = createDocument('urn:document:worker-stale');
  const readable = createDocument('urn:document:worker-readable');
  const storage = createFakeStorage({
    plan: createPlan([
      { document_id: 'urn:document:worker-missing', segment_ids: ['urn:document:worker-missing-segment-0'] },
      { document_id: stale.document_id, segment_ids: ['urn:document:worker-stale-segment-0'] },
      {
        document_id: readable.document_id,
        segment_ids: readable.segments.map(({ id }) => id)
      }
    ]),
    documents: {
      [changed.document_id]: changed,
      [stale.document_id]: stale,
      [readable.document_id]: readable
    }
  });
  const embed = createEmbed();

  const result = await runEmbeddingBackfill({ storage, embed, model_id: modelId, owner_id: ownerId });

  assert.deepEqual(result.skipped_documents, [
    { document_id: 'urn:document:worker-missing', reason: 'document is not readable' },
    { document_id: stale.document_id, reason: 'document changed since the plan' }
  ]);
  assert.equal(result.processed_documents, 1);
  assert.equal(result.embedded_segments, 3);
  assert.deepEqual(storage.calls.save.map(({ document_id }) => document_id), [readable.document_id]);
  assert.deepEqual(embed.calls.map(({ inputs }) => inputs), [texts]);
});

test('fails closed when the embedder returns the wrong number of vectors', async () => {
  const document = createDocument('urn:document:worker-short');
  const storage = createFakeStorage({
    plan: createPlan([{ document_id: document.document_id, segment_ids: document.segments.map(({ id }) => id) }]),
    documents: { [document.document_id]: document }
  });

  await assert.rejects(
    runEmbeddingBackfill({
      storage,
      embed: async () => [[1, 0, 0]],
      model_id: modelId,
      owner_id: ownerId
    }),
    /embed must return one vector per input segment/
  );
  assert.deepEqual(storage.calls.save, []);
});

test('propagates an embedder failure after earlier documents stay committed', async () => {
  const first = createDocument('urn:document:worker-first');
  const second = createDocument('urn:document:worker-second');
  const storage = createFakeStorage({
    plan: createPlan([
      { document_id: first.document_id, segment_ids: first.segments.map(({ id }) => id) },
      { document_id: second.document_id, segment_ids: second.segments.map(({ id }) => id) }
    ]),
    documents: { [first.document_id]: first, [second.document_id]: second }
  });
  let calls = 0;
  const embed = async ({ inputs }) => {
    calls += 1;
    if (calls === 2) throw new Error('provider unavailable');
    return inputs.map((_, index) => [index, 1, 0]);
  };

  await assert.rejects(
    runEmbeddingBackfill({ storage, embed, model_id: modelId, owner_id: ownerId }),
    /provider unavailable/
  );
  assert.deepEqual(storage.calls.save.map(({ document_id }) => document_id), [first.document_id]);
});

test('propagates a storage write failure without continuing to the next document', async () => {
  const first = createDocument('urn:document:worker-write-first');
  const second = createDocument('urn:document:worker-write-second');
  const storage = createFakeStorage({
    plan: createPlan([
      { document_id: first.document_id, segment_ids: first.segments.map(({ id }) => id) },
      { document_id: second.document_id, segment_ids: second.segments.map(({ id }) => id) }
    ]),
    documents: { [first.document_id]: first, [second.document_id]: second },
    onSave: async () => {
      throw new Error('document must belong to the owner and be active');
    }
  });
  const embed = createEmbed();

  await assert.rejects(
    runEmbeddingBackfill({ storage, embed, model_id: modelId, owner_id: ownerId }),
    /document must belong to the owner and be active/
  );
  assert.equal(embed.calls.length, 1);
  assert.equal(storage.calls.save.length, 1);
});
