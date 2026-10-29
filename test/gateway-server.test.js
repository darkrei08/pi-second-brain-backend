import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import test from 'node:test';

import { createAuthenticator } from '../src/gateway-auth.js';
import { createGatewayServer } from '../src/gateway-server.js';

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
    saveDocumentAndSegments: record('saveDocumentAndSegments', undefined),
    listDocumentCollections: record('listDocumentCollections', ['synthetic-collection-alpha']),
    ...overrides
  };
  return storage;
}

function withServer(storage, options = {}) {
  const gateway = createGatewayServer({ storage, authenticator, ...options });
  return gateway;
}

async function call(gateway, path, { method = 'GET', headers = auth, body, rawBody, contentLength } = {}) {
  const { port } = await gateway.start({ port: 0 });
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
  const missing = await expectStatus(gateway2, '/v1/nope', { headers: {} }, 404);
  assert.equal(missing.body.error.code, 'not_found');

  const gateway3 = withServer(createRecordingStorage());
  const wrongMethod = await expectStatus(gateway3, '/v1/models', { method: 'POST', headers: auth, body: {} }, 405);
  assert.equal(wrongMethod.body.error.code, 'method_not_allowed');
  assert.equal(wrongMethod.headers.allow, 'GET');
});

test('reports readiness from a real storage read', async () => {
  const ready = await expectStatus(withServer(createRecordingStorage()), '/readyz', { headers: {} }, 200);
  assert.deepEqual(ready.body, { status: 'ready' });

  const failing = withServer(createRecordingStorage({
    listEmbeddingModels: async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:55432');
    }
  }));
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
  assert.equal(lexical.body.mode.mode, 'lexical');
  assert.equal(lexical.body.mode.matches, 1);

  const hybridStorage = createRecordingStorage();
  const hybridGateway = withServer(hybridStorage);
  const hybrid = await call(hybridGateway, '/v1/retrieval/query', {
    method: 'POST',
    body: { mode: 'hybrid', query: 'invoice', model_id: 'synthetic-3d', query_embedding: [1, 0, 0] }
  });
  await hybridGateway.stop();
  assert.equal(hybrid.status, 200);
  assert.equal(hybridStorage.calls[0].input.owner_id, 'owner-one');
  assert.equal(hybrid.body.mode.mode, 'hybrid');

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
});

test('reports malformed seam input as a caller error', async () => {
  const storage = createRecordingStorage({
    searchSegmentsLexical: async () => {
      throw new TypeError('query must be non-empty text');
    }
  });
  const gateway = withServer(storage);
  const response = await call(gateway, '/v1/retrieval/query', { method: 'POST', body: { query: 'invoice' } });
  await gateway.stop();
  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: { code: 'invalid_request', message: 'query must be non-empty text' } });
});

test('reports an unexpected dependency failure without leaking it', async () => {
  const storage = createRecordingStorage({
    searchSegmentsLexical: async () => {
      throw new Error('relation "segments" does not exist at /var/lib/postgresql/data');
    }
  });
  const gateway = withServer(storage);
  const response = await call(gateway, '/v1/retrieval/query', { method: 'POST', body: { query: 'invoice' } });
  await gateway.stop();
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { error: { code: 'internal_error', message: 'The request failed' } });
});
