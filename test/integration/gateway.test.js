import assert from 'node:assert/strict';
import test from 'node:test';

import { createAuthenticator } from '../../src/gateway-auth.js';
import { createGatewayServer } from '../../src/gateway-server.js';
import { createStorage, segmentDocument } from '../../src/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const pg = databaseUrl ? (await import('pg')).default : null;
const pool = pg ? new pg.Pool({ connectionString: databaseUrl }) : null;
const token = 'g'.repeat(32);
const owner_id = 'gateway-integration-owner';
const collection_id = 'gateway-integration-collection';

async function call(base, path, { method = 'GET', headers = {}, body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

async function callText(base, path, { method = 'GET', headers = {}, body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, headers: response.headers, body: await response.text() };
}

if (pool) {
  test.after(async () => pool.end());
}

test('drives ingest, retrieval, and citation revalidation over HTTP', { skip: !pool }, async () => {
  const storage = createStorage({ pool });
  await pool.query('DELETE FROM documents WHERE owner_id = $1', [owner_id]);
  await pool.query('DELETE FROM collections WHERE owner_id = $1', [owner_id]);
  await storage.createCollection({ collection_id, owner_id, created_at: '2026-01-04T00:00:00Z' });

  const gateway = createGatewayServer({
    storage,
    authenticator: createAuthenticator({ token, owner_id, shell_users: {} })
  });
  const { url } = await gateway.start({ port: 0 });

  try {
    assert.equal((await call(url, '/healthz')).status, 200);
    assert.equal((await fetch(`${url}/v1/models`)).status, 401);

    const ingest = await call(url, '/v1/documents/ingest', {
      method: 'POST',
      body: {
        document: {
          document_id: 'urn:document:gateway-integration',
          text: 'invoice alpha quarterly.\n\ncontract beta renewal.',
          source_label: 'gateway-integration.txt',
          source_hash: `sha256:${'cd'.repeat(32)}`,
          lineage: { parser: 'synthetic-parser@1.0.0', model: null },
          created_at: '2026-01-04T00:00:00Z',
          collections: [collection_id]
        },
        max_segment_chars: 40
      }
    });
    assert.equal(ingest.status, 200);
    assert.equal(ingest.body.document_id, 'urn:document:gateway-integration');
    assert.deepEqual(ingest.body.collections, [collection_id]);
    assert.ok(ingest.body.segments >= 2);

    const scoped = await call(url, '/v1/retrieval/query', {
      method: 'POST',
      body: { query: 'invoice', collection_ids: [collection_id] }
    });
    assert.equal(scoped.status, 200);
    assert.equal(scoped.body.retrieval.mode, 'lexical');
    assert.ok(scoped.body.matches.length >= 1);

    const unscoped = await call(url, '/v1/retrieval/query', { method: 'POST', body: { query: 'nonexistent-term' } });
    assert.deepEqual(unscoped.body.matches, []);
    assert.equal(unscoped.body.retrieval.mode, 'empty');

    const match = scoped.body.matches[0];
    const citations = await call(url, '/v1/citations/resolve', {
      method: 'POST',
      body: {
        citations: [{
          document_id: match.document_id,
          segment_id: match.id,
          citation: { ref: match.id, source_hash: match.source_hash, segment_hash: `sha256:${match.text_sha256}` }
        }]
      }
    });
    assert.equal(citations.status, 200);
    assert.deepEqual(citations.body, { valid: true, stale_ids: [] });

    const models = await call(url, '/v1/models');
    assert.equal(models.status, 200);
    assert.ok(Array.isArray(models.body.models));
  } finally {
    await gateway.stop();
    await pool.query('DELETE FROM documents WHERE owner_id = $1', [owner_id]);
    await pool.query('DELETE FROM collections WHERE owner_id = $1', [owner_id]);
  }
});

test('ingest creates an owner collection and idempotent membership through HTTP', { skip: !pool }, async () => {
  const storage = createStorage({ pool });
  const document_id = 'urn:document:gateway-collection-ingest';
  const folder_id = 'shell-folder-idempotent';
  await pool.query('DELETE FROM documents WHERE owner_id = $1', [owner_id]);
  await pool.query('DELETE FROM collections WHERE owner_id = $1', [owner_id]);

  const gateway = createGatewayServer({
    storage,
    authenticator: createAuthenticator({ token, owner_id, shell_users: {} })
  });
  const { url } = await gateway.start({ port: 0 });
  const body = {
    document: {
      document_id,
      text: 'invoice alpha',
      source_label: 'gateway-collection-ingest.txt',
      source_hash: `sha256:${'a1'.repeat(32)}`,
      lineage: { parser: 'synthetic-parser@1.0.0', model: null },
      created_at: '2026-01-08T00:00:00Z',
      collections: [folder_id, folder_id]
    }
  };

  try {
    assert.equal((await call(url, '/v1/documents/ingest', { method: 'POST', body })).status, 200);
    assert.equal((await call(url, '/v1/documents/ingest', { method: 'POST', body })).status, 200);
    const exported = await storage.exportOwner(owner_id);
    assert.equal(exported.collections.length, 1);
    assert.deepEqual(exported.collections[0].collection_id, folder_id);
    assert.deepEqual(exported.collections[0].owner_id, owner_id);
    assert.match(exported.collections[0].created_at, /^\d{4}-\d{2}-\d{2}T/u);
    assert.deepEqual(exported.documents.map(({ document_id: id, collection_ids }) => ({ document_id: id, collection_ids })), [
      { document_id, collection_ids: [folder_id] }
    ]);
  } finally {
    await gateway.stop();
    await pool.query('DELETE FROM documents WHERE owner_id = $1', [owner_id]);
    await pool.query('DELETE FROM collections WHERE owner_id = $1', [owner_id]);
  }
});

test('unknown and empty collection scopes return zero matches without read creation', { skip: !pool }, async () => {
  const storage = createStorage({ pool });
  const empty_folder_id = 'shell-folder-empty';
  const unknown_folder_id = 'shell-folder-unknown';
  await pool.query('DELETE FROM documents WHERE owner_id = $1', [owner_id]);
  await pool.query('DELETE FROM collections WHERE owner_id = $1', [owner_id]);
  await storage.createCollection({ collection_id: empty_folder_id, owner_id, created_at: '2026-01-08T00:00:00Z' });

  const gateway = createGatewayServer({
    storage,
    authenticator: createAuthenticator({ token, owner_id, shell_users: {} })
  });
  const { url } = await gateway.start({ port: 0 });
  try {
    for (const collection_ids of [[unknown_folder_id], [empty_folder_id], []]) {
      const response = await call(url, '/v1/retrieval/query', {
        method: 'POST',
        body: { query: 'invoice', collection_ids }
      });
      assert.equal(response.status, 200);
      assert.deepEqual(response.body.matches, []);
    }
    const exported = await storage.exportOwner(owner_id);
    assert.deepEqual(exported.collections.map(({ collection_id }) => collection_id), [empty_folder_id]);
    assert.deepEqual(exported.documents, []);
  } finally {
    await gateway.stop();
    await pool.query('DELETE FROM documents WHERE owner_id = $1', [owner_id]);
    await pool.query('DELETE FROM collections WHERE owner_id = $1', [owner_id]);
  }
});

test('ingest preserves an opaque folder id and stores no collection label', { skip: !pool }, async () => {
  const storage = createStorage({ pool });
  const document_id = 'urn:document:gateway-opaque-collection';
  const folder_id = 'Folder.~opaque_7';
  await pool.query('DELETE FROM documents WHERE owner_id = $1', [owner_id]);
  await pool.query('DELETE FROM collections WHERE owner_id = $1', [owner_id]);

  const gateway = createGatewayServer({
    storage,
    authenticator: createAuthenticator({ token, owner_id, shell_users: {} })
  });
  const { url } = await gateway.start({ port: 0 });
  try {
    const response = await call(url, '/v1/documents/ingest', {
      method: 'POST',
      body: {
        document: {
          document_id,
          text: 'invoice opaque folder',
          source_label: 'gateway-opaque-collection.txt',
          source_hash: `sha256:${'b2'.repeat(32)}`,
          lineage: { parser: 'synthetic-parser@1.0.0', model: null },
          created_at: '2026-01-08T00:00:00Z',
          collections: [folder_id]
        }
      }
    });
    assert.equal(response.status, 200);
    const exported = await storage.exportOwner(owner_id);
    assert.deepEqual(Object.keys(exported.collections[0]).sort(), ['collection_id', 'created_at', 'owner_id']);
    assert.equal(exported.collections[0].collection_id, folder_id);
    assert.deepEqual(exported.documents[0].collection_ids, [folder_id]);
  } finally {
    await gateway.stop();
    await pool.query('DELETE FROM documents WHERE owner_id = $1', [owner_id]);
    await pool.query('DELETE FROM collections WHERE owner_id = $1', [owner_id]);
  }
});

test('refuses a document that another owner already holds', { skip: !pool }, async () => {
  const storage = createStorage({ pool });
  const document_id = 'urn:document:gateway-owner-clash';
  const foreign = {
    document_id,
    text: 'invoice foreign owner',
    source_label: 'gateway-owner-clash.txt',
    source_hash: `sha256:${'ef'.repeat(32)}`,
    lineage: { parser: 'synthetic-parser@1.0.0', model: null },
    created_at: '2026-01-04T00:00:00Z',
    retention: { owner_id: 'gateway-integration-foreign', state: 'active' }
  };
  await pool.query('DELETE FROM documents WHERE document_id = $1', [document_id]);
  await storage.saveDocumentAndSegments(foreign, segmentDocument(foreign, { max_segment_chars: 40 }));

  const gateway = createGatewayServer({
    storage,
    authenticator: createAuthenticator({ token, owner_id, shell_users: {} })
  });
  const { url } = await gateway.start({ port: 0 });
  try {
    const attempt = await call(url, '/v1/documents/ingest', {
      method: 'POST',
      body: { document: { ...foreign, retention: undefined } }
    });
    assert.equal(attempt.status, 409);
    assert.deepEqual(attempt.body, { error: { code: 'conflict', message: 'document belongs to a different owner' } });
    const stored = await storage.getDocumentWithSegments(document_id, 'gateway-integration-foreign');
    assert.equal(stored.retention.owner_id, 'gateway-integration-foreign');
  } finally {
    await gateway.stop();
    await pool.query('DELETE FROM documents WHERE document_id = $1', [document_id]);
  }
});

test('answers a question from real evidence with a fake chat adapter', { skip: !pool }, async () => {
  const storage = createStorage({ pool });
  const document_id = 'urn:document:gateway-answer-integration';
  await pool.query('DELETE FROM documents WHERE owner_id = $1', [owner_id]);
  await pool.query('DELETE FROM collections WHERE owner_id = $1', [owner_id]);
  await storage.createCollection({ collection_id, owner_id, created_at: '2026-01-06T00:00:00Z' });

  const document = {
    document_id,
    text: 'The invoice alpha is filed under the contract beta.',
    source_label: 'gateway-answer-integration.txt',
    source_hash: `sha256:${'ab'.repeat(32)}`,
    lineage: { parser: 'synthetic-parser@1.0.0', model: null },
    created_at: '2026-01-06T00:00:00Z',
    retention: { owner_id, state: 'active' },
    collections: [collection_id]
  };
  await storage.saveDocumentAndSegments(document, segmentDocument(document, { max_segment_chars: 200 }));

  const prompts = [];
  const chat = async (input) => {
    prompts.push(input);
    return 'The invoice alpha is filed under contract beta [1].';
  };
  chat.stream = async function* (input) {
    prompts.push(input);
    yield 'The invoice alpha is filed under ';
    yield 'contract beta [1].';
  };
  const gateway = createGatewayServer({
    storage,
    authenticator: createAuthenticator({ token, owner_id, shell_users: {} }),
    chat,
    answer_model: 'synthetic-chat'
  });
  const { url } = await gateway.start({ port: 0 });
  try {
    const answer = await call(url, '/v1/answers', {
      method: 'POST',
      body: { question: 'invoice alpha', collection_ids: [collection_id] }
    });
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    assert.equal(answer.body.citations.length, 1, JSON.stringify(answer.body));
    assert.equal(answer.body.citations[0].document_id, document_id);
    assert.equal(answer.body.citations[0].citation.source_hash, document.source_hash);
    assert.deepEqual(answer.body.stale_citations, []);
    assert.deepEqual(answer.body.uncertainty, {
      level: 'low',
      mode: 'lexical',
      evidence_count: 1,
      cited_count: 1,
      unresolved_count: 0,
      stale_count: 0
    });
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].messages[1].content.includes('invoice alpha'), true);

    const completion = await call(url, '/v1/chat/completions', {
      method: 'POST',
      body: {
        model: 'client-model-is-ignored',
        messages: [{ role: 'user', content: 'invoice alpha' }],
        collection_ids: [collection_id]
      }
    });
    assert.equal(completion.status, 200, JSON.stringify(completion.body));
    assert.equal(completion.body.object, 'chat.completion');
    assert.equal(completion.body.choices[0].message.role, 'assistant');
    assert.equal(completion.body.choices[0].message.content, 'The invoice alpha is filed under contract beta [1].');
    assert.equal(completion.body.answer_metadata.citations[0].document_id, document_id);
    assert.equal(completion.body.answer_metadata.uncertainty.level, 'low');
    assert.equal(prompts[1].model_id, 'synthetic-chat');

    const streamed = await callText(url, '/v1/chat/completions', {
      method: 'POST',
      body: {
        model: 'client-model-is-ignored',
        messages: [{ role: 'user', content: 'invoice alpha' }],
        collection_ids: [collection_id],
        stream: true
      }
    });
    assert.equal(streamed.status, 200);
    assert.match(streamed.headers.get('content-type'), /^text\/event-stream/u);
    const events = streamed.body.split('\n\n').filter(Boolean).map((event) => {
      const data = event.replace(/^data: /u, '');
      return data === '[DONE]' ? data : JSON.parse(data);
    });
    assert.equal(events.at(-1), '[DONE]');
    assert.equal(events.at(-2).answer_metadata.citations[0].document_id, document_id);
    assert.equal(events.at(-2).answer_metadata.uncertainty.level, 'low');
    assert.equal(prompts[2].model_id, 'synthetic-chat');

    const unanswered = await call(url, '/v1/answers', {
      method: 'POST',
      body: { question: 'zzz-no-such-term' }
    });
    assert.equal(unanswered.status, 200);
    assert.equal(unanswered.body.uncertainty.level, 'unsupported');
    assert.equal(prompts.length, 3, 'no model call without evidence');

    const stale = await pool.query('UPDATE documents SET source_hash = $2 WHERE document_id = $1', [
      document_id,
      `sha256:${'cd'.repeat(32)}`
    ]);
    assert.equal(stale.rowCount, 1);
    const staleAnswer = await call(url, '/v1/answers', {
      method: 'POST',
      body: { question: 'invoice alpha' }
    });
    assert.equal(staleAnswer.status, 200);
    assert.equal(staleAnswer.body.uncertainty.level, 'high');
    assert.equal(staleAnswer.body.stale_citations.length, 1);
  } finally {
    await gateway.stop();
    await pool.query('DELETE FROM documents WHERE owner_id = $1', [owner_id]);
    await pool.query('DELETE FROM collections WHERE owner_id = $1', [owner_id]);
  }
});

test('downgrades an answer whose captured evidence was superseded', { skip: !pool }, async () => {
  const storage = createStorage({ pool });
  const document_id = 'urn:document:gateway-answer-stale';
  const base = {
    document_id,
    text: 'invoice alpha original wording',
    source_label: 'gateway-answer-stale.txt',
    source_hash: `sha256:${'ee'.repeat(32)}`,
    lineage: { parser: 'synthetic-parser@1.0.0', model: null },
    created_at: '2026-01-07T00:00:00Z',
    retention: { owner_id, state: 'active' }
  };
  await pool.query('DELETE FROM documents WHERE owner_id = $1', [owner_id]);
  await storage.saveDocumentAndSegments(base, segmentDocument(base, { max_segment_chars: 200 }));

  const captured = await storage.searchSegmentsLexical({ query: 'invoice alpha', owner_id, limit: 6 });
  assert.equal(captured.length, 1);

  const superseded = { ...base, text: 'invoice alpha rewritten wording', source_hash: `sha256:${'ff'.repeat(32)}` };
  await storage.saveDocumentAndSegments(superseded, segmentDocument(superseded, { max_segment_chars: 200 }));

  const staleStorage = {
    searchSegmentsLexical: async () => captured,
    revalidateCitations: (citations, options) => storage.revalidateCitations(citations, options)
  };
  const gateway = createGatewayServer({
    storage: staleStorage,
    authenticator: createAuthenticator({ token, owner_id, shell_users: {} }),
    chat: async () => 'The invoice alpha was filed under contract beta [1].',
    answer_model: 'synthetic-chat'
  });
  const { url } = await gateway.start({ port: 0 });
  try {
    const answer = await call(url, '/v1/answers', { method: 'POST', body: { question: 'invoice alpha' } });
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    assert.deepEqual(answer.body.stale_citations, [captured[0].id]);
    assert.equal(answer.body.uncertainty.level, 'high');
    assert.equal(answer.body.uncertainty.stale_count, 1);
  } finally {
    await gateway.stop();
    await pool.query('DELETE FROM documents WHERE owner_id = $1', [owner_id]);
  }
});

test('answers with hybrid evidence and reports no uncertainty', { skip: !pool }, async () => {
  const storage = createStorage({ pool });
  const document_id = 'urn:document:gateway-answer-hybrid';
  const model_id = 'synthetic-answer-3d';
  const document = {
    document_id,
    text: 'invoice alpha hybrid evidence',
    source_label: 'gateway-answer-hybrid.txt',
    source_hash: `sha256:${'ab'.repeat(32)}`,
    lineage: { parser: 'synthetic-parser@1.0.0', model: null },
    created_at: '2026-01-08T00:00:00Z',
    retention: { owner_id, state: 'active' }
  };
  await pool.query('DELETE FROM documents WHERE owner_id = $1', [owner_id]);
  await storage.registerEmbeddingModel({ model_id, dimensions: 3 });
  await storage.saveDocumentAndSegments(document, segmentDocument(document, { max_segment_chars: 200 }));
  const stored = await storage.getDocumentWithSegments(document_id, owner_id);
  await storage.saveSegmentEmbeddings({
    document_id,
    owner_id,
    model_id,
    dimensions: 3,
    embeddings: stored.segments.map((segment) => ({ segment_id: segment.id, embedding: [1, 0, 0] })),
    created_at: document.created_at
  });

  const gateway = createGatewayServer({
    storage,
    authenticator: createAuthenticator({ token, owner_id, shell_users: {} }),
    chat: async () => 'The invoice alpha is hybrid evidence [1].',
    answer_model: 'synthetic-chat',
    embed: async ({ dimensions, inputs }) => {
      assert.equal(dimensions, 3);
      assert.deepEqual(inputs, ['invoice alpha']);
      return [[1, 0, 0]];
    }
  });
  const { url } = await gateway.start({ port: 0 });
  try {
    const answer = await call(url, '/v1/answers', {
      method: 'POST',
      body: { question: 'invoice alpha', embedding_model_id: model_id }
    });
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    assert.equal(answer.body.retrieval.mode, 'hybrid');
    assert.equal(answer.body.uncertainty.level, 'none');
    assert.equal(answer.body.citations.length, 1);
  } finally {
    await gateway.stop();
    await pool.query('DELETE FROM documents WHERE owner_id = $1', [owner_id]);
    await pool.query('DELETE FROM embedding_models WHERE model_id = $1', [model_id]);
  }
});

test('proposes document filing without changing membership and confirms one idempotent membership', { skip: !pool }, async () => {
  const storage = createStorage({ pool });
  const member = {
    document_id: 'urn:document:gateway-proposal-member',
    text: 'invoice alpha quarterly renewal',
    source_label: 'gateway-proposal-member.txt',
    source_hash: `sha256:${'a7'.repeat(32)}`,
    lineage: { parser: 'synthetic-parser@1.0.0', model: null },
    created_at: '2026-01-09T00:00:00Z',
    retention: { owner_id, state: 'active' },
    collections: [collection_id]
  };
  const target = {
    document_id: 'urn:document:gateway-proposal-target',
    text: 'invoice alpha renewal',
    source_label: 'gateway-proposal-target.txt',
    source_hash: `sha256:${'a8'.repeat(32)}`,
    lineage: { parser: 'synthetic-parser@1.0.0', model: null },
    created_at: '2026-01-09T00:00:00Z',
    retention: { owner_id, state: 'active' }
  };
  await pool.query('DELETE FROM documents WHERE owner_id = $1', [owner_id]);
  await pool.query('DELETE FROM collections WHERE owner_id = $1', [owner_id]);
  await storage.createCollection({ collection_id, owner_id, created_at: '2026-01-09T00:00:00Z' });
  await storage.saveDocumentAndSegments(member, segmentDocument(member, { max_segment_chars: 200 }));
  await storage.saveDocumentAndSegments(target, segmentDocument(target, { max_segment_chars: 200 }));

  const gateway = createGatewayServer({
    storage,
    authenticator: createAuthenticator({ token, owner_id, shell_users: {} })
  });
  const { url } = await gateway.start({ port: 0 });
  try {
    const proposal = await call(url, '/v1/documents/collections/suggest', {
      method: 'POST',
      body: { document_id: target.document_id }
    });
    assert.equal(proposal.status, 200, JSON.stringify(proposal.body));
    assert.equal(proposal.body.document_id, target.document_id);
    assert.equal(proposal.body.candidates[0].collection_id, collection_id);
    assert.ok(proposal.body.candidates[0].score > 0);
    assert.deepEqual(await storage.listDocumentCollections(target.document_id, owner_id), []);

    const confirmation = {
      method: 'POST',
      body: { document_id: target.document_id, collection_ids: [collection_id, collection_id] }
    };
    assert.equal((await call(url, '/v1/documents/collections/confirm', confirmation)).status, 200);
    assert.equal((await call(url, '/v1/documents/collections/confirm', confirmation)).status, 200);
    assert.deepEqual(await storage.listDocumentCollections(target.document_id, owner_id), [collection_id]);
  } finally {
    await gateway.stop();
    await pool.query('DELETE FROM documents WHERE owner_id = $1', [owner_id]);
    await pool.query('DELETE FROM collections WHERE owner_id = $1', [owner_id]);
  }
});
