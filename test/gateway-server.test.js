import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import test from 'node:test';

import { createAuthenticator } from '../src/gateway-auth.js';
import { createGatewayServer } from '../src/gateway-server.js';
import { segmentDocument } from '../src/index.js';

const token = 'a'.repeat(32);
const authenticator = createAuthenticator({
  token,
  owner_id: 'operator-owner',
  shell_users: { 'shell-one': 'owner-one' }
});
const auth = { authorization: `Bearer ${token}`, 'x-shell-user-id': 'shell-one' };

function createRecordingStorage(overrides = {}) {
  const calls = [];
  const record = (name, result) => async (...args) => {
    calls.push({ name, input: args[0], args });
    if (result instanceof Error) throw result;
    return typeof result === 'function' ? result(...args) : result;
  };
  const storage = {
    calls,
    listEmbeddingModels: record('listEmbeddingModels', [{ model_id: 'synthetic-3d', dimensions: 3, status: 'active' }]),
    getEmbeddingModel: record('getEmbeddingModel', { model_id: 'synthetic-3d', dimensions: 3, status: 'active' }),
    inspectEmbeddingCoverage: record('inspectEmbeddingCoverage', { model_id: 'synthetic-3d', total_segments: 2 }),
    searchSegmentsLexical: record('searchSegmentsLexical', [{ id: 'urn:segment:a', document_id: 'urn:document:a', rank: 0.5 }]),
    searchSegmentsHybrid: record('searchSegmentsHybrid', [
      { id: 'urn:segment:a', document_id: 'urn:document:a', semantic_rank: 1, lexical_rank: 1, hybrid_score: 0.1 }
    ]),
    revalidateCitations: record('revalidateCitations', { valid: false, stale_ids: ['urn:segment:a'] }),
    searchSegmentsLexicalAnswerable: record('searchSegmentsLexicalAnswerable', []),
    saveDocumentAndSegments: record('saveDocumentAndSegments', undefined),
    listDocumentCollections: record('listDocumentCollections', ['synthetic-collection-alpha']),
    ...overrides
  };
  return storage;
}

function withServer(storage, options = {}) {
  return createGatewayServer({ storage, authenticator, answer_model: 'synthetic-chat', ...options });
}

async function call(gateway, path, { method = 'GET', headers = auth, body, rawBody, contentLength, port: existingPort } = {}) {
  const port = existingPort ?? (await gateway.start({ port: 0 })).port;
  const payload = rawBody ?? (body === undefined ? undefined : JSON.stringify(body));
  const requestHeaders = { ...headers };
  if (payload !== undefined && requestHeaders['content-type'] === undefined) {
    requestHeaders['content-type'] = 'application/json';
  }
  if (contentLength !== undefined) requestHeaders['content-length'] = contentLength;
  return await new Promise((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port, path, method, headers: requestHeaders }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: response.statusCode, headers: response.headers, body: text === '' ? null : JSON.parse(text) });
      });
    });
    request.on('error', reject);
    if (payload !== undefined) request.write(payload);
    request.end();
  });
}

async function callText(gateway, path, { method = 'GET', headers = auth, body, port: existingPort } = {}) {
  const port = existingPort ?? (await gateway.start({ port: 0 })).port;
  return await new Promise((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port, path, method, headers: { ...headers, 'content-type': 'application/json' } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('error', reject);
    request.end(JSON.stringify(body));
  });
}

async function expectStatus(gateway, path, options, status) {
  const response = await call(gateway, path, options);
  await gateway.stop();
  assert.equal(response.status, status, `${path} -> ${response.status} ${JSON.stringify(response.body)}`);
  return response;
}

test('serves liveness without a dependency and refuses unknown routes and methods', async () => {
  const storage = createRecordingStorage();
  const gateway = withServer(storage);
  const health = await expectStatus(gateway, '/healthz', { headers: {} }, 200);
  assert.deepEqual(health.body, { status: 'ok' });
  assert.deepEqual(storage.calls, []);

  const gateway2 = withServer(createRecordingStorage());
  const missing = await expectStatus(gateway2, '/v1/nope', { headers: auth }, 404);
  assert.equal(missing.body.error.code, 'not_found');

  const gateway2b = withServer(createRecordingStorage());
  const hidden = await expectStatus(gateway2b, '/v1/nope', { headers: {} }, 401);
  assert.equal(hidden.body.error.code, 'unauthorized');

  const gateway3 = withServer(createRecordingStorage());
  const wrongMethod = await expectStatus(gateway3, '/v1/models', { method: 'POST', headers: auth, body: {} }, 405);
  assert.equal(wrongMethod.body.error.code, 'method_not_allowed');
  assert.equal(wrongMethod.headers.allow, 'GET');
});

test('reports readiness from storage and provider metadata without a completion or audit event', async () => {
  const completionCalls = [];
  const probeCalls = [];
  const auditEvents = [];
  const chat = async (input) => {
    completionCalls.push(input);
    return 'must not be called';
  };
  chat.probe = async (model_id) => {
    probeCalls.push(model_id);
  };
  const readyGateway = withServer(createRecordingStorage(), { chat, audit: (event) => auditEvents.push(event) });
  const readyPort = (await readyGateway.start({ port: 0 })).port;
  const ready = await call(readyGateway, '/readyz', { headers: {}, port: readyPort });
  const cached = await call(readyGateway, '/readyz', { headers: {}, port: readyPort });
  await readyGateway.stop();
  assert.equal(ready.status, 200);
  assert.deepEqual(ready.body, { status: 'ready' });
  assert.equal(cached.status, 200);
  assert.deepEqual(probeCalls, ['synthetic-chat']);
  assert.deepEqual(completionCalls, []);
  assert.deepEqual(auditEvents, []);

  const unreachable = async () => {
    throw new Error('completion must not be called');
  };
  unreachable.probe = async () => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:11434');
  };
  const unreachableAudit = [];
  const unreachableGateway = withServer(createRecordingStorage(), { chat: unreachable, audit: (event) => unreachableAudit.push(event) });
  const unreachablePort = (await unreachableGateway.start({ port: 0 })).port;
  const refused = await call(unreachableGateway, '/readyz', { headers: {}, port: unreachablePort });
  const cachedRefusal = await call(unreachableGateway, '/readyz', { headers: {}, port: unreachablePort });
  await unreachableGateway.stop();
  assert.equal(refused.status, 503);
  assert.equal(cachedRefusal.status, 503);
  assert.equal(refused.body.error.code, 'not_ready');
  assert.equal(JSON.stringify(refused.body).includes('ECONNREFUSED'), false);
  assert.deepEqual(unreachableAudit, []);

  const failing = withServer(createRecordingStorage({
    listEmbeddingModels: async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:55432');
    }
  }), { chat: async () => 'should not be called' });
  const response = await call(failing, '/readyz', { headers: {} });
  await failing.stop();
  assert.equal(response.status, 503);
  assert.equal(response.body.error.code, 'not_ready');
  assert.equal(JSON.stringify(response.body).includes('ECONNREFUSED'), false);
});

test('authenticates every data route and refuses a caller-supplied owner', async () => {
  const storage = createRecordingStorage();
  const gateway = withServer(storage);
  const unauthorized = await expectStatus(gateway, '/v1/models', { headers: {} }, 401);
  assert.equal(unauthorized.body.error.code, 'unauthorized');

  const gateway2 = withServer(storage);
  const wrongToken = await expectStatus(gateway2, '/v1/models', { headers: { authorization: `Bearer ${'b'.repeat(32)}` } }, 401);
  assert.equal(wrongToken.body.error.code, 'unauthorized');

  const gateway3 = withServer(storage);
  const unmapped = await expectStatus(
    gateway3,
    '/v1/retrieval/query',
    { method: 'POST', headers: { authorization: `Bearer ${token}`, 'x-shell-user-id': 'shell-unknown' }, body: { query: 'x' } },
    403
  );
  assert.equal(unmapped.body.error.code, 'unknown_identity');

  const gateway4 = withServer(storage);
  const forged = await expectStatus(
    gateway4,
    '/v1/retrieval/query',
    { method: 'POST', body: { query: 'invoice', owner_id: 'owner-two' } },
    400
  );
  assert.equal(forged.body.error.code, 'invalid_request');
  assert.deepEqual(storage.calls, []);
});

test('caps the body before parsing and requires JSON', async () => {
  const gateway = withServer(createRecordingStorage());
  const declaredTooLarge = await call(gateway, '/v1/retrieval/query', {
    method: 'POST',
    body: { query: 'invoice' },
    contentLength: String(2 * 1024 * 1024)
  });
  await gateway.stop();
  assert.equal(declaredTooLarge.status, 413);
  assert.equal(declaredTooLarge.body.error.code, 'body_too_large');

  const streaming = withServer(createRecordingStorage());
  const streamedTooLarge = await call(streaming, '/v1/retrieval/query', {
    method: 'POST',
    rawBody: 'x'.repeat(1024 * 1024 + 1)
  });
  await streaming.stop();
  assert.equal(streamedTooLarge.status, 413);

  const wrongType = withServer(createRecordingStorage());
  const notJson = await call(wrongType, '/v1/retrieval/query', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'text/plain' },
    rawBody: '{"query":"invoice"}'
  });
  await wrongType.stop();
  assert.equal(notJson.status, 415);

  const malformed = withServer(createRecordingStorage());
  const broken = await call(malformed, '/v1/retrieval/query', { method: 'POST', rawBody: '{"query":' });
  await malformed.stop();
  assert.equal(broken.status, 400);
  assert.equal(broken.body.error.code, 'invalid_json');
});

test('runs lexical and hybrid retrieval with the derived owner and the collection scope', async () => {
  const storage = createRecordingStorage();
  const gateway = withServer(storage);
  const lexical = await call(gateway, '/v1/retrieval/query', {
    method: 'POST',
    body: { query: 'invoice', collection_ids: ['synthetic-collection-alpha'], limit: 5 }
  });
  await gateway.stop();
  assert.equal(lexical.status, 200);
  assert.deepEqual(storage.calls[0].args, [{
    query: 'invoice',
    owner_id: 'owner-one',
    limit: 5,
    collection_ids: ['synthetic-collection-alpha']
  }]);
  assert.equal(lexical.body.retrieval.mode, 'lexical');
  assert.equal(lexical.body.retrieval.matches, 1);

  const hybridStorage = createRecordingStorage();
  const hybridGateway = withServer(hybridStorage);
  const hybrid = await call(hybridGateway, '/v1/retrieval/query', {
    method: 'POST',
    body: { mode: 'hybrid', query: 'invoice', model_id: 'synthetic-3d', query_embedding: [1, 0, 0] }
  });
  await hybridGateway.stop();
  assert.equal(hybrid.status, 200);
  assert.equal(hybridStorage.calls[0].input.owner_id, 'owner-one');
  assert.equal(hybrid.body.retrieval.mode, 'hybrid');

  const embedderCalls = [];
  const embedGateway = withServer(createRecordingStorage(), {
    embed: async (input) => {
      embedderCalls.push(input);
      return [[1, 0, 0]];
    }
  });
  const embedded = await call(embedGateway, '/v1/retrieval/query', {
    method: 'POST',
    body: { mode: 'hybrid', query: 'invoice', model_id: 'synthetic-3d' }
  });
  await embedGateway.stop();
  assert.equal(embedded.status, 200);
  assert.deepEqual(embedderCalls, [{ model_id: 'synthetic-3d', dimensions: 3, inputs: ['invoice'] }]);

  const noEmbedder = withServer(createRecordingStorage());
  const refused = await expectStatus(
    noEmbedder,
    '/v1/retrieval/query',
    { method: 'POST', body: { mode: 'hybrid', query: 'invoice', model_id: 'synthetic-3d' } },
    400
  );
  assert.match(refused.body.error.message, /query_embedding/);
});

test('resolves a citation batch within the storage limit', async () => {
  const storage = createRecordingStorage();
  const gateway = withServer(storage);
  const resolved = await call(gateway, '/v1/citations/resolve', {
    method: 'POST',
    body: {
      citations: [
        { document_id: 'urn:document:a', segment_id: 'urn:segment:a', citation: { source_hash: 'sha256:x', segment_hash: 'sha256:y' } }
      ]
    }
  });
  await gateway.stop();
  assert.equal(resolved.status, 200);
  assert.deepEqual(resolved.body, { valid: false, stale_ids: ['urn:segment:a'] });
  assert.equal(storage.calls[0].args[1].owner_id, 'owner-one');

  const tooMany = withServer(createRecordingStorage());
  const rejected = await expectStatus(
    tooMany,
    '/v1/citations/resolve',
    { method: 'POST', body: { citations: Array.from({ length: 101 }, () => ({})) } },
    400
  );
  assert.match(rejected.body.error.message, /100/);
});

test('lists models and the derived owner coverage on request', async () => {
  const storage = createRecordingStorage();
  const gateway = withServer(storage);
  const listed = await call(gateway, '/v1/models');
  await gateway.stop();
  assert.equal(listed.status, 200);
  assert.equal(listed.body.models.length, 1);
  assert.equal(listed.body.coverage, undefined);
  assert.deepEqual(storage.calls.map(({ name }) => name), ['listEmbeddingModels']);

  const covered = withServer(createRecordingStorage());
  const withCoverage = await call(covered, '/v1/models?model_id=synthetic-3d');
  await covered.stop();
  assert.equal(withCoverage.body.coverage.total_segments, 2);
  assert.deepEqual(withCoverage.body.coverage, { model_id: 'synthetic-3d', total_segments: 2 });
});

test('ingests through the segmentation seam with a server-derived owner', async () => {
  const storage = createRecordingStorage();
  const gateway = withServer(storage);
  const response = await call(gateway, '/v1/documents/ingest', {
    method: 'POST',
    body: {
      document: {
        document_id: 'urn:document:gateway-ingest',
        text: 'Invoice alpha. Contract beta.',
        source_label: 'gateway-ingest.txt',
        source_hash: `sha256:${'ab'.repeat(32)}`,
        lineage: { parser: 'synthetic-parser@1.0.0', model: null },
        created_at: '2026-01-03T00:00:00Z',
        collections: ['synthetic-collection-alpha']
      },
      max_segment_chars: 40
    }
  });
  await gateway.stop();
  assert.equal(response.status, 200);
  const saved = storage.calls.find(({ name }) => name === 'saveDocumentAndSegments');
  assert.equal(saved.input.retention.owner_id, 'owner-one');
  assert.equal(saved.input.retention.state, 'active');
  assert.deepEqual(saved.input.collections, ['synthetic-collection-alpha']);
  assert.deepEqual(response.body, {
    document_id: 'urn:document:gateway-ingest',
    collections: ['synthetic-collection-alpha'],
    segments: response.body.segments
  });
  assert.ok(response.body.segments >= 1);

  const forgedRetention = withServer(createRecordingStorage());
  const rejected = await expectStatus(
    forgedRetention,
    '/v1/documents/ingest',
    { method: 'POST', body: { document: { document_id: 'urn:document:x', retention: { owner_id: 'owner-two' } } } },
    400
  );
  assert.match(rejected.body.error.message, /owner_id/);

  const nestedOwner = withServer(createRecordingStorage());
  const nested = await expectStatus(
    nestedOwner,
    '/v1/documents/ingest',
    {
      method: 'POST',
      body: {
        document: {
          document_id: 'urn:document:x',
          owner_id: 'owner-two',
          text: 'x',
          source_label: 'x.txt',
          source_hash: `sha256:${'ab'.repeat(32)}`,
          lineage: { parser: 'synthetic-parser@1.0.0', model: null },
          created_at: '2026-01-03T00:00:00Z'
        }
      }
    },
    400
  );
  assert.match(nested.body.error.message, /owner_id/);
});

test('maps a refused ingest to a conflict and a missing collection to a caller error', async () => {
  const conflicting = withServer(createRecordingStorage({
    saveDocumentAndSegments: async () => {
      throw new Error('document belongs to a different owner');
    }
  }));
  const conflict = await call(conflicting, '/v1/documents/ingest', {
    method: 'POST',
    body: {
      document: {
        document_id: 'urn:document:gateway-conflict',
        text: 'Invoice alpha.',
        source_label: 'gateway-conflict.txt',
        source_hash: `sha256:${'ab'.repeat(32)}`,
        lineage: { parser: 'synthetic-parser@1.0.0', model: null },
        created_at: '2026-01-03T00:00:00Z'
      }
    }
  });
  await conflicting.stop();
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, 'conflict');

  const missingCollection = withServer(createRecordingStorage({
    saveDocumentAndSegments: async () => {
      throw new Error('unknown or foreign collection for this owner');
    }
  }));
  const refused = await call(missingCollection, '/v1/documents/ingest', {
    method: 'POST',
    body: {
      document: {
        document_id: 'urn:document:gateway-missing-collection',
        text: 'Invoice alpha.',
        source_label: 'gateway-missing.txt',
        source_hash: `sha256:${'ab'.repeat(32)}`,
        lineage: { parser: 'synthetic-parser@1.0.0', model: null },
        created_at: '2026-01-03T00:00:00Z',
        collections: ['synthetic-collection-unknown']
      }
    }
  });
  await missingCollection.stop();
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error.code, 'invalid_request');
});

test('reports an unregistered model as a caller error on coverage', async () => {
  const storage = createRecordingStorage({
    inspectEmbeddingCoverage: async () => {
      throw new Error('embedding model is not registered');
    }
  });
  const gateway = withServer(storage);
  const response = await call(gateway, '/v1/models?model_id=synthetic-unknown');
  await gateway.stop();
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'invalid_request');
});

test('reports malformed seam input as a caller error without an incident trace', async () => {
  const storage = createRecordingStorage({
    searchSegmentsLexical: async () => {
      throw new TypeError('query must be non-empty text');
    }
  });
  const traces = [];
  const gateway = withServer(storage, { trace: (event) => traces.push(event) });
  const response = await call(gateway, '/v1/retrieval/query', { method: 'POST', body: { query: 'invoice' } });
  await gateway.stop();
  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: { code: 'invalid_request', message: 'query must be non-empty text' } });
  assert.deepEqual(traces, []);
});

test('reports an unexpected dependency failure with one sanitized trace', async () => {
  const storage = createRecordingStorage({
    searchSegmentsLexical: async () => {
      throw new Error('relation "segments" does not exist at /var/lib/postgresql/data');
    }
  });
  const traces = [];
  const gateway = withServer(storage, { trace: (event) => traces.push(event) });
  const response = await call(gateway, '/v1/retrieval/query', {
    method: 'POST',
    body: { query: 'invoice payload must not be logged', evidence: 'private evidence', answer: 'private answer' }
  });
  await gateway.stop();
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { error: { code: 'internal_error', message: 'The request failed' } });
  assert.deepEqual(traces, [{ event: 'gateway_unexpected_failure', route: 'POST /v1/retrieval/query', error_class: 'Error' }]);
  assert.equal(JSON.stringify(traces).includes('invoice payload must not be logged'), false);
  assert.equal(JSON.stringify(traces).includes('private evidence'), false);
  assert.equal(JSON.stringify(traces).includes('private answer'), false);
});

function answerableStorage() {
  const ownerId = 'owner-one';
  const document = {
    document_id: 'urn:document:gateway-answer',
    text: 'The invoice alpha is filed under the contract.',
    source_label: 'gateway-answer.txt',
    source_hash: `sha256:${'ac'.repeat(32)}`,
    lineage: { parser: 'synthetic-parser@1.0.0', model: null },
    created_at: '2026-01-06T00:00:00Z',
    retention: { owner_id: ownerId, state: 'active' }
  };
  const segmented = segmentDocument(document, { max_segment_chars: 200 });
  const matches = segmented.segments.map((segment) => ({
    ...segment,
    source_hash: document.source_hash,
    source_label: document.source_label,
    owner_id: ownerId,
    retention_state: 'active',
    rank: 0.5
  }));
  const calls = [];
  return {
    calls,
    async getEmbeddingModel(model_id) {
      calls.push({ name: 'getEmbeddingModel', input: { model_id } });
      return { model_id, dimensions: 3, status: 'active' };
    },
    async searchSegmentsLexical(input) {
      calls.push({ name: 'searchSegmentsLexical', input });
      return matches;
    },
    async searchSegmentsHybrid(input) {
      calls.push({ name: 'searchSegmentsHybrid', input });
      return matches;
    },
    async revalidateCitations(citations, options) {
      calls.push({ name: 'revalidateCitations', input: { citations, options } });
      return { valid: true, stale_ids: [] };
    }
  };
}

test('answers over evidence with a derived owner and the injected chat adapter', async () => {
  const storage = answerableStorage();
  const chatCalls = [];
  const gateway = withServer(storage, {
    chat: async (input) => {
      chatCalls.push(input);
      return 'The invoice alpha is filed under the contract [1].';
    }
  });
  const response = await call(gateway, '/v1/answers', {
    method: 'POST',
    body: { question: 'where is the invoice alpha?' }
  });
  await gateway.stop();
  assert.equal(response.status, 200);
  assert.equal(response.body.citations.length, 1);
  assert.deepEqual(response.body.unresolved_citations, []);
  assert.deepEqual(response.body.stale_citations, []);
  assert.equal(response.body.uncertainty.level, 'low');
  assert.equal(response.body.uncertainty.evidence_count, 1);
  assert.equal(chatCalls.length, 1);
  assert.equal(chatCalls[0].model_id, 'synthetic-chat');
  assert.equal(chatCalls[0].messages[0].role, 'system');
  assert.equal(chatCalls[0].messages[1].content.includes('where is the invoice alpha?'), true);
  const search = storage.calls.find(({ name }) => name === 'searchSegmentsLexical');
  assert.equal(search.input.owner_id, 'owner-one');
});

test('records one audit event per provider call without any caller text', async () => {
  const events = [];
  const gateway = withServer(answerableStorage(), {
    audit: (event) => events.push(event),
    embed: async () => [[1, 0, 0]],
    chat: async () => 'The invoice alpha is filed under the contract [1].'
  });
  const { port } = await gateway.start({ port: 0 });
  const answered = await call(gateway, '/v1/answers', {
    port,
    method: 'POST',
    body: { question: 'where is the invoice alpha?' }
  });
  const embedded = await call(gateway, '/v1/retrieval/query', {
    port,
    method: 'POST',
    body: { mode: 'hybrid', query: 'sensitive query text', model_id: 'synthetic-3d' }
  });
  await gateway.stop();
  assert.equal(answered.status, 200);
  assert.equal(embedded.status, 200);
  assert.deepEqual(
    events.map(({ kind, route, model_id, outcome }) => `${kind} ${route} ${model_id} ${outcome}`),
    ['chat POST /v1/answers synthetic-chat ok', 'embedding POST /v1/retrieval/query synthetic-3d ok']
  );
  assert.equal(events.every((event) => event.event === 'model_call'), true);
  assert.equal(events.every((event) => event.owner_id === 'owner-one'), true);
  assert.equal(events.every((event) => Number.isInteger(event.duration_ms)), true);
  const serialized = JSON.stringify(events);
  for (const text of ['where is the invoice alpha', 'invoice alpha is filed', 'sensitive query text', 'contract [1]']) {
    assert.equal(serialized.includes(text), false);
  }

  const failed = [];
  const failing = withServer(answerableStorage(), {
    audit: (event) => failed.push(event),
    chat: async () => { throw new Error('provider down'); }
  });
  const failedResponse = await call(failing, '/v1/answers', { method: 'POST', body: { question: 'error case' } });
  await failing.stop();
  assert.equal(failedResponse.status, 500);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].outcome, 'failed');

  const budgeted = [];
  const capped = withServer(answerableStorage(), {
    audit: (event) => budgeted.push(event),
    model_requests_per_minute: 1,
    chat: async () => 'answer [1].'
  });
  const cappedPort = (await capped.start({ port: 0 })).port;
  const first = await call(capped, '/v1/answers', { port: cappedPort, method: 'POST', body: { question: 'first' } });
  const refused = await call(capped, '/v1/answers', { port: cappedPort, method: 'POST', body: { question: 'second' } });
  await capped.stop();
  assert.equal(first.status, 200);
  assert.equal(refused.status, 429);
  assert.equal(budgeted.length, 1);

  assert.throws(() => withServer(answerableStorage(), { audit: 'stderr' }), /audit must be a function/);
});

test('refuses an answer request without a configured model and without authentication', async () => {
  const unconfigured = withServer(answerableStorage(), { chat: undefined, answer_model: undefined });
  const unavailable = await expectStatus(
    unconfigured,
    '/v1/answers',
    { method: 'POST', body: { question: 'where is the invoice alpha?' } },
    503
  );
  assert.equal(unavailable.body.error.code, 'answers_unavailable');

  const unauthenticated = withServer(answerableStorage(), { chat: async () => 'x [1].' });
  const refused = await expectStatus(
    unauthenticated,
    '/v1/answers',
    { method: 'POST', headers: {}, body: { question: 'where is the invoice alpha?' } },
    401
  );
  assert.equal(refused.body.error.code, 'unauthorized');

  const forged = withServer(answerableStorage(), { chat: async () => 'x [1].' });
  const rejected = await expectStatus(
    forged,
    '/v1/answers',
    { method: 'POST', body: { question: 'where?', owner_id: 'owner-two' } },
    400
  );
  assert.equal(rejected.body.error.code, 'invalid_request');
});

test('maps a malformed provider response and an embedder failure to boundary errors', async () => {
  const malformed = withServer(answerableStorage(), {
    chat: async () => {
      throw new Error('chat response must be valid JSON');
    }
  });
  const broken = await expectStatus(malformed, '/v1/answers', { method: 'POST', body: { question: 'invoice alpha' } }, 502);
  assert.equal(broken.body.error.code, 'model_failed');

  const embedTimeout = withServer(answerableStorage(), {
    chat: async () => 'x [1].',
    embed: async () => {
      throw new Error('embedding request timed out');
    }
  });
  const timedOutEmbed = await expectStatus(
    embedTimeout,
    '/v1/answers',
    { method: 'POST', body: { question: 'invoice alpha', embedding_model_id: 'synthetic-3d' } },
    504
  );
  assert.equal(timedOutEmbed.body.error.code, 'model_timeout');

  const embedFailed = withServer(answerableStorage(), {
    chat: async () => 'x [1].',
    embed: async () => {
      throw new Error('embedding request failed with status 500');
    }
  });
  const failedEmbed = await expectStatus(
    embedFailed,
    '/v1/answers',
    { method: 'POST', body: { question: 'invoice alpha', embedding_model_id: 'synthetic-3d' } },
    502
  );
  assert.equal(failedEmbed.body.error.code, 'model_failed');
});

test('maps a provider timeout and a provider failure to stable boundary errors', async () => {
  const timeout = withServer(answerableStorage(), {
    chat: async () => {
      throw new Error('chat request timed out');
    }
  });
  const timedOut = await expectStatus(timeout, '/v1/answers', { method: 'POST', body: { question: 'where?' } }, 504);
  assert.equal(timedOut.body.error.code, 'model_timeout');

  const failing = withServer(answerableStorage(), {
    chat: async () => {
      throw new Error('chat request failed with status 429');
    }
  });
  const failed = await expectStatus(failing, '/v1/answers', { method: 'POST', body: { question: 'where?' } }, 502);
  assert.equal(failed.body.error.code, 'model_failed');
});

test('returns a buffered OpenAI chat completion grounded by answerQuestion', async () => {
  const storage = answerableStorage();
  const chatCalls = [];
  const gateway = withServer(storage, {
    chat: async (input) => {
      chatCalls.push(input);
      return 'The invoice alpha is filed under the contract [1].';
    }
  });
  const response = await call(gateway, '/v1/chat/completions', {
    method: 'POST',
    body: {
      model: 'client-selected-model',
      messages: [{ role: 'user', content: 'where is the invoice alpha?' }],
      collection_ids: ['synthetic-collection-alpha']
    }
  });
  await gateway.stop();
  assert.equal(response.status, 200);
  assert.equal(response.body.object, 'chat.completion');
  assert.equal(response.body.model, 'synthetic-chat');
  assert.equal(response.body.choices[0].message.role, 'assistant');
  assert.equal(response.body.choices[0].message.content, 'The invoice alpha is filed under the contract [1].');
  assert.equal(response.body.choices[0].finish_reason, 'stop');
  assert.equal(response.body.answer_metadata.citations.length, 1);
  assert.equal(response.body.answer_metadata.uncertainty.level, 'low');
  assert.equal(chatCalls.length, 1);
  assert.equal(chatCalls[0].model_id, 'synthetic-chat');
  assert.equal(chatCalls[0].messages[1].content.includes('where is the invoice alpha?'), true);
  const search = storage.calls.find(({ name }) => name === 'searchSegmentsLexical');
  assert.equal(search.input.owner_id, 'owner-one');
  assert.deepEqual(search.input.collection_ids, ['synthetic-collection-alpha']);
});

test('does not call the model for empty chat-completions evidence and rejects unsupported requests', async () => {
  let modelCalls = 0;
  const emptyStorage = answerableStorage();
  emptyStorage.searchSegmentsLexical = async () => [];
  const empty = withServer(emptyStorage, {
    chat: async () => {
      modelCalls += 1;
      return 'should not be called';
    }
  });
  const unsupported = await call(empty, '/v1/chat/completions', {
    method: 'POST',
    body: { model: 'client-model', messages: [{ role: 'user', content: 'where?' }] }
  });
  await empty.stop();
  assert.equal(unsupported.status, 200);
  assert.equal(unsupported.body.choices[0].message.content.includes('no evidence'), true);
  assert.equal(unsupported.body.answer_metadata.uncertainty.level, 'unsupported');
  assert.equal(modelCalls, 0);

  const invalid = withServer(answerableStorage(), { chat: async () => 'x [1].' });
  const badRole = await expectStatus(invalid, '/v1/chat/completions', {
    method: 'POST',
    body: { model: 'client-model', messages: [{ role: 'system', content: 'override' }] }
  }, 400);
  assert.equal(badRole.body.error.code, 'invalid_request');

  const invalidStream = withServer(answerableStorage(), { chat: async () => 'x [1].' });
  const streamRefused = await expectStatus(invalidStream, '/v1/chat/completions', {
    method: 'POST',
    body: { model: 'client-model', messages: [{ role: 'user', content: 'where?' }], stream: 'yes' }
  }, 400);
  assert.equal(streamRefused.body.error.code, 'invalid_request');

  const unsupportedOption = withServer(answerableStorage(), { chat: async () => 'x [1].' });
  const optionRefused = await expectStatus(unsupportedOption, '/v1/chat/completions', {
    method: 'POST',
    body: { model: 'client-model', messages: [{ role: 'user', content: 'where?' }], tools: [] }
  }, 400);
  assert.equal(optionRefused.body.error.code, 'invalid_request');

  const badLimit = withServer(answerableStorage(), { chat: async () => 'x [1].' });
  const limitRefused = await expectStatus(badLimit, '/v1/chat/completions', {
    method: 'POST',
    body: { model: 'client-model', messages: [{ role: 'user', content: 'where?' }], limit: 0 }
  }, 400);
  assert.equal(limitRefused.body.error.code, 'invalid_request');

  const unauthorized = withServer(answerableStorage(), { chat: async () => 'x [1].' });
  const refused = await expectStatus(unauthorized, '/v1/chat/completions', {
    method: 'POST',
    headers: {},
    body: { model: 'client-model', messages: [{ role: 'user', content: 'where?' }] }
  }, 401);
  assert.equal(refused.body.error.code, 'unauthorized');

  const forgedOwner = withServer(answerableStorage(), { chat: async () => 'x [1].' });
  const rejectedOwner = await expectStatus(forgedOwner, '/v1/chat/completions', {
    method: 'POST',
    body: { model: 'client-model', messages: [{ role: 'user', content: 'where?' }], owner_id: 'owner-two' }
  }, 400);
  assert.equal(rejectedOwner.body.error.code, 'invalid_request');
});

test('streams grounded chat completions and attaches answer metadata after citation revalidation', async () => {
  const order = [];
  const storage = answerableStorage();
  const originalRevalidate = storage.revalidateCitations;
  storage.revalidateCitations = async (...args) => {
    order.push('revalidated');
    return await originalRevalidate(...args);
  };
  const chat = async () => {
    throw new Error('buffered chat path must not run');
  };
  chat.stream = async function* () {
    order.push('stream-started');
    yield 'The invoice alpha ';
    yield 'is filed under the contract [1].';
    order.push('stream-ended');
  };
  const gateway = withServer(storage, { chat });
  const response = await callText(gateway, '/v1/chat/completions', {
    method: 'POST',
    body: {
      model: 'client-model-is-ignored',
      messages: [{ role: 'user', content: 'where is the invoice alpha?' }],
      stream: true
    }
  });
  await gateway.stop();
  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /^text\/event-stream/u);
  const events = response.body.split('\n\n').filter(Boolean).map((event) => {
    const data = event.replace(/^data: /u, '');
    return data === '[DONE]' ? data : JSON.parse(data);
  });
  assert.equal(events.at(-1), '[DONE]');
  const chunks = events.slice(0, -1);
  assert.equal(chunks[0].choices[0].delta.role, 'assistant');
  assert.deepEqual(chunks.map(({ choices }) => choices[0].delta.content).filter(Boolean), [
    'The invoice alpha ',
    'is filed under the contract [1].'
  ]);
  const final = chunks.at(-1);
  assert.equal(final.model, 'synthetic-chat');
  assert.equal(final.choices[0].finish_reason, 'stop');
  assert.equal(final.answer_metadata.citations.length, 1);
  assert.equal(final.answer_metadata.uncertainty.level, 'low');
  assert.ok(order.indexOf('revalidated') > order.indexOf('stream-ended'));
});

test('aborts upstream streaming when the client disconnects', { timeout: 2000 }, async () => {
  let signal;
  let observeAbort;
  const aborted = new Promise((resolve) => { observeAbort = resolve; });
  const chat = async () => '';
  chat.stream = async function* (input) {
    signal = input.signal;
    yield 'partial answer';
    await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
    observeAbort();
  };
  const gateway = withServer(answerableStorage(), { chat });
  const { port } = await gateway.start({ port: 0 });
  const request = httpRequest({
    host: '127.0.0.1',
    port,
    path: '/v1/chat/completions',
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' }
  });
  request.on('response', (response) => response.once('data', () => request.destroy()));
  request.end(JSON.stringify({
    model: 'client-model',
    messages: [{ role: 'user', content: 'where?' }],
    stream: true
  }));
  await aborted;
  assert.equal(signal.aborted, true);
  await gateway.stop();
});

test('bounds model-backed concurrency and releases slots after success and failure', { timeout: 3000 }, async () => {
  let releaseChat;
  let chatStarted;
  const started = new Promise((resolve) => { chatStarted = resolve; });
  const heldChat = new Promise((resolve) => { releaseChat = resolve; });
  let chatCalls = 0;
  const gateway = withServer(answerableStorage(), {
    max_model_concurrency: 1,
    chat: async () => {
      chatCalls += 1;
      if (chatCalls === 1) {
        chatStarted();
        await heldChat;
      }
      return 'answer [1].';
    }
  });
  const { port } = await gateway.start({ port: 0 });
  const first = call(gateway, '/v1/answers', {
    port, method: 'POST', body: { question: 'first' }
  });
  await started;
  const overloaded = await call(gateway, '/v1/answers', {
    port, method: 'POST', body: { question: 'second' }
  });
  const retrieval = await call(gateway, '/v1/retrieval/query', {
    port, method: 'POST', body: { query: 'independent route' }
  });
  releaseChat();
  const firstResponse = await first;
  await gateway.stop();
  assert.equal(overloaded.status, 429);
  assert.equal(overloaded.body.error.code, 'model_busy');
  assert.equal(JSON.stringify(overloaded.body).includes('provider'), false);
  assert.equal(chatCalls, 1);
  assert.equal(firstResponse.status, 200);
  assert.equal(retrieval.status, 200);

  const errorGateway = withServer(answerableStorage(), {
    max_model_concurrency: 1,
    chat: async () => { throw new Error('unexpected handler failure'); }
  });
  const errorPort = (await errorGateway.start({ port: 0 })).port;
  assert.equal((await call(errorGateway, '/v1/answers', { port: errorPort, method: 'POST', body: { question: 'error' } })).status, 500);
  assert.equal((await call(errorGateway, '/v1/answers', { port: errorPort, method: 'POST', body: { question: 'after error' } })).status, 500);
  await errorGateway.stop();
});

test('applies a fixed per-owner model budget and resets it without affecting other owners', { timeout: 3000 }, async () => {
  const originalNow = Date.now;
  let now = 1_000;
  Date.now = () => now;
  let modelCalls = 0;
  const ownerOneToken = 'a'.repeat(32);
  const ownerTwoToken = 'b'.repeat(32);
  const budgetGateway = withServer(answerableStorage(), {
    authenticator: createAuthenticator({ principals: [
      { token: ownerOneToken, owner_id: 'owner-one' },
      { token: ownerTwoToken, owner_id: 'owner-two' }
    ] }),
    model_requests_per_minute: 1,
    chat: async () => { modelCalls += 1; return 'answer [1].'; }
  });
  const port = (await budgetGateway.start({ port: 0 })).port;
  const ownerOne = { authorization: `Bearer ${ownerOneToken}` };
  const ownerTwo = { authorization: `Bearer ${ownerTwoToken}` };
  try {
    assert.equal((await call(budgetGateway, '/v1/answers', { port, method: 'POST', headers: ownerOne, body: { question: 'first' } })).status, 200);
    const exhausted = await call(budgetGateway, '/v1/research', { port, method: 'POST', headers: ownerOne, body: { question: 'second' } });
    assert.equal(exhausted.status, 429);
    assert.equal(exhausted.body.error.code, 'model_busy');
    assert.equal(JSON.stringify(exhausted.body).includes('provider'), false);
    assert.equal((await call(budgetGateway, '/v1/answers', { port, method: 'POST', headers: ownerTwo, body: { question: 'other owner' } })).status, 200);
    assert.equal(modelCalls, 2);
    now += 60_000;
    assert.equal((await call(budgetGateway, '/v1/answers', { port, method: 'POST', headers: ownerOne, body: { question: 'reset' } })).status, 200);
  } finally {
    Date.now = originalNow;
    await budgetGateway.stop();
  }
});

test('holds a model slot until a streaming response ends', { timeout: 3000 }, async () => {
  let releaseStream;
  let streamStarted;
  const started = new Promise((resolve) => { streamStarted = resolve; });
  const heldStream = new Promise((resolve) => { releaseStream = resolve; });
  const chat = async () => '';
  chat.stream = async function* () {
    streamStarted();
    yield 'partial answer';
    await heldStream;
    yield ' complete [1].';
  };
  const gateway = withServer(answerableStorage(), { max_model_concurrency: 1, chat });
  const { port } = await gateway.start({ port: 0 });
  const stream = callText(gateway, '/v1/chat/completions', {
    port, method: 'POST', body: { model: 'client', messages: [{ role: 'user', content: 'question' }], stream: true }
  });
  await started;
  const overloaded = await call(gateway, '/v1/answers', { port, method: 'POST', body: { question: 'second' } });
  releaseStream();
  const streamed = await stream;
  const afterStream = await call(gateway, '/v1/answers', { port, method: 'POST', body: { question: 'after stream' } });
  await gateway.stop();
  assert.equal(overloaded.status, 429);
  assert.equal(overloaded.body.error.code, 'model_busy');
  assert.equal(streamed.status, 200);
  assert.notEqual(afterStream.status, 429);
});

test('streams empty-evidence answers without a model call and sanitizes post-header failures', async () => {
  let modelCalls = 0;
  const emptyStorage = answerableStorage();
  emptyStorage.searchSegmentsLexical = async () => [];
  const emptyChat = async () => {
    modelCalls += 1;
    return 'must not be called';
  };
  emptyChat.stream = async function* () {
    modelCalls += 1;
    yield 'must not be called';
  };
  const emptyGateway = withServer(emptyStorage, { chat: emptyChat });
  const emptyResponse = await callText(emptyGateway, '/v1/chat/completions', {
    method: 'POST',
    body: { model: 'client-model', messages: [{ role: 'user', content: 'where?' }], stream: true }
  });
  await emptyGateway.stop();
  assert.equal(emptyResponse.status, 200);
  assert.equal(emptyResponse.body.includes('no evidence'), true);
  assert.equal(emptyResponse.body.includes('unsupported'), true);
  assert.equal(modelCalls, 0);

  const earlyFailureChat = async () => '';
  earlyFailureChat.stream = async function* () {
    throw new Error('chat response stream failed: provider secret must not leak');
  };
  const earlyFailureGateway = withServer(answerableStorage(), { chat: earlyFailureChat });
  const earlyFailure = await call(earlyFailureGateway, '/v1/chat/completions', {
    method: 'POST',
    body: { model: 'client-model', messages: [{ role: 'user', content: 'where?' }], stream: true }
  });
  await earlyFailureGateway.stop();
  assert.equal(earlyFailure.status, 502);
  assert.deepEqual(earlyFailure.body, { error: { code: 'model_failed', message: 'The model request failed' } });

  const failingChat = async () => '';
  failingChat.stream = async function* () {
    yield 'partial answer';
    throw new Error('chat response stream failed: provider secret must not leak');
  };
  const failingGateway = withServer(answerableStorage(), { chat: failingChat });
  const failed = await callText(failingGateway, '/v1/chat/completions', {
    method: 'POST',
    body: { model: 'client-model', messages: [{ role: 'user', content: 'where?' }], stream: true }
  });
  await failingGateway.stop();
  assert.equal(failed.status, 200);
  assert.equal(failed.body.includes('provider secret'), false);
  assert.equal(failed.body.includes('[DONE]'), false);
  assert.equal(failed.body.includes('model_failed'), true);

  const brokenStorage = answerableStorage();
  brokenStorage.revalidateCitations = async () => { throw new TypeError('database path must not leak'); };
  const citationChat = async () => '';
  citationChat.stream = async function* () { yield 'Answer with citation [1].'; };
  const brokenGateway = withServer(brokenStorage, { chat: citationChat });
  const broken = await callText(brokenGateway, '/v1/chat/completions', {
    method: 'POST',
    body: { model: 'client-model', messages: [{ role: 'user', content: 'where?' }], stream: true }
  });
  await brokenGateway.stop();
  assert.equal(broken.body.includes('database path'), false);
  assert.equal(broken.body.includes('internal_error'), true);
  assert.equal(broken.body.includes('answer_metadata'), false);
  assert.equal(broken.body.includes('[DONE]'), false);
});

test('serves bounded research with the authenticated owner and an unchanged collection scope', async () => {
  const storage = answerableStorage();
  const matches = [1, 2, 3, 4].map((index) => ({
    id: `segment-${index}`,
    document_id: `document-${index}`,
    text: `evidence ${index}`,
    source_label: `source-${index}.txt`
  }));
  const byQuery = new Map([
    ['main question', [matches[0], matches[1]]],
    ['follow-up alpha', [matches[1], matches[2]]],
    ['follow-up beta', [matches[2], matches[3]]]
  ]);
  const searchInputs = [];
  storage.searchSegmentsLexical = async (input) => {
    searchInputs.push(input);
    return byQuery.get(input.query) ?? [];
  };
  const chatCalls = [];
  const gateway = withServer(storage, {
    chat: async (input) => {
      chatCalls.push(input);
      return input.max_tokens === 128
        ? JSON.stringify({ queries: ['follow-up alpha', 'follow-up beta'] })
        : 'The research answer has an uncertainty report.';
    }
  });
  const response = await call(gateway, '/v1/research', {
    method: 'POST',
    body: { question: 'main question', collection_ids: ['synthetic-collection-alpha'], limit: 6 }
  });
  await gateway.stop();
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.deepEqual(Object.keys(response.body).sort(), [
    'answer', 'citations', 'retrieval', 'stale_citations', 'uncertainty', 'unresolved_citations'
  ]);
  assert.equal(response.body.answer, 'The research answer has an uncertainty report.');
  assert.equal(response.body.retrieval.matches, 4);
  assert.equal(chatCalls.length, 2);
  assert.deepEqual(searchInputs.map(({ query }) => query), ['main question', 'follow-up alpha', 'follow-up beta']);
  assert.ok(searchInputs.every(({ owner_id }) => owner_id === 'owner-one'));
  assert.ok(searchInputs.every(({ collection_ids }) => collection_ids[0] === 'synthetic-collection-alpha'));

  const unauthenticated = withServer(answerableStorage(), { chat: async () => 'unused' });
  const refused = await expectStatus(unauthenticated, '/v1/research', { method: 'POST', headers: {}, body: { question: 'q' } }, 401);
  assert.equal(refused.body.error.code, 'unauthorized');

  const forged = withServer(answerableStorage(), { chat: async () => 'unused' });
  const rejected = await expectStatus(forged, '/v1/research', { method: 'POST', body: { question: 'q', owner_id: 'owner-two' } }, 400);
  assert.equal(rejected.body.error.code, 'invalid_request');

  const unsupported = withServer(answerableStorage(), { chat: async () => 'unused' });
  const rejectedField = await expectStatus(unsupported, '/v1/research', { method: 'POST', body: { question: 'q', stream: true } }, 400);
  assert.equal(rejectedField.body.error.code, 'invalid_request');
});

test('keeps an unknown research collection scoped and returns unsupported evidence', async () => {
  const storage = answerableStorage();
  const searchInputs = [];
  storage.searchSegmentsLexical = async (input) => { searchInputs.push(input); return []; };
  let modelCalls = 0;
  const gateway = withServer(storage, { chat: async () => { modelCalls += 1; return 'must not run'; } });
  const response = await call(gateway, '/v1/research', {
    method: 'POST',
    body: { question: 'private question', collection_ids: ['unknown-collection'] }
  });
  await gateway.stop();
  assert.equal(response.status, 200);
  assert.equal(response.body.uncertainty.level, 'unsupported');
  assert.deepEqual(searchInputs.map(({ collection_ids }) => collection_ids), [['unknown-collection']]);
  assert.equal(modelCalls, 0);
});
