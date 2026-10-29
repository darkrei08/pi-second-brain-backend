import assert from 'node:assert/strict';
import test from 'node:test';

import { createOpenAICompatibleEmbedder, runEmbeddingBackfill } from '../src/index.js';

const apiKey = 'sk-test-secret-value';
const modelId = 'text-embedding-synthetic-3d';

function vectorsFor(inputs, dimensions = 3) {
  return inputs.map((_, index) => Array.from({ length: dimensions }, (_, axis) => (axis === index % dimensions ? 1 : 0)));
}

function createFetch({ status = 200, body = {}, onRequest } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (onRequest) onRequest({ url: String(url), init });
    return {
      ok: status >= 200 && status < 300,
      status,
      async json() {
        return body;
      }
    };
  };
  fetch.calls = calls;
  return fetch;
}

function embedderBody(inputs, dimensions = 3) {
  const vectors = vectorsFor(inputs, dimensions);
  return {
    data: vectors.map((embedding, index) => ({ index, embedding }))
  };
}

test('rejects unsafe or malformed configuration at construction', () => {
  assert.throws(() => createOpenAICompatibleEmbedder({ fetch: null, base_url: 'https://api.example.test/v1' }), /fetch must be a function/);
  assert.throws(
    () => createOpenAICompatibleEmbedder({ fetch: createFetch(), base_url: '/v1' }),
    /base_url must be an absolute http or https URL/
  );
  assert.throws(
    () => createOpenAICompatibleEmbedder({ fetch: createFetch(), base_url: 'https://api.example.test/v1', api_key: '' }),
    /api_key must be non-empty text/
  );
  assert.throws(
    () => createOpenAICompatibleEmbedder({ fetch: createFetch(), base_url: 'https://api.example.test/v1', timeout_ms: 0 }),
    /timeout_ms must be an integer between 1 and 600000/
  );
  assert.throws(
    () => createOpenAICompatibleEmbedder({ fetch: createFetch(), base_url: 'http://embeddings.example.test/v1', api_key: apiKey }),
    /must use https unless the host is loopback/
  );
});

test('sends the documented request to a loopback endpoint without a key', async () => {
  const inputs = ['alpha one.', 'beta two.'];
  const fetch = createFetch({ body: embedderBody(inputs) });
  const embed = createOpenAICompatibleEmbedder({ fetch, base_url: 'http://127.0.0.1:8080/v1/' });

  const vectors = await embed({ model_id: modelId, dimensions: 3, inputs });

  assert.equal(fetch.calls.length, 1);
  const [{ url, init }] = fetch.calls;
  assert.equal(url, 'http://127.0.0.1:8080/v1/embeddings');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['content-type'], 'application/json');
  assert.equal(init.headers.authorization, undefined);
  assert.equal(init.redirect, 'error');
  assert.deepEqual(JSON.parse(init.body), { model: modelId, input: inputs });
  assert.ok(init.signal instanceof AbortSignal);
  assert.deepEqual(vectors, vectorsFor(inputs));
});

test('sends the bearer header for an https endpoint and keeps input order', async () => {
  const inputs = ['alpha one.', 'beta two.', 'gamma three.'];
  const vectors = vectorsFor(inputs);
  const shuffled = {
    data: [
      { index: 2, embedding: vectors[2] },
      { index: 0, embedding: vectors[0] },
      { index: 1, embedding: vectors[1] }
    ]
  };
  const fetch = createFetch({ body: shuffled });
  const embed = createOpenAICompatibleEmbedder({
    fetch,
    base_url: 'https://api.example.test/v1',
    api_key: apiKey
  });

  const result = await embed({ model_id: modelId, dimensions: 3, inputs });

  assert.equal(fetch.calls[0].init.headers.authorization, `Bearer ${apiKey}`);
  assert.deepEqual(result, vectors);
});

test('fails closed on transport and payload defects without leaking the key or the payload', async () => {
  const inputs = ['alpha one.'];
  const failing = createOpenAICompatibleEmbedder({
    fetch: createFetch({ status: 500, body: { error: { message: 'upstream exploded' } } }),
    base_url: 'https://api.example.test/v1',
    api_key: apiKey
  });
  await assert.rejects(failing({ model_id: modelId, dimensions: 3, inputs }), (error) => {
    assert.match(error.message, /status 500/);
    assert.doesNotMatch(error.message, /sk-test-secret-value/);
    assert.doesNotMatch(error.message, /upstream exploded/);
    return true;
  });

  const notJson = createOpenAICompatibleEmbedder({
    fetch: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } }),
    base_url: 'https://api.example.test/v1',
    api_key: apiKey
  });
  await assert.rejects(notJson({ model_id: modelId, dimensions: 3, inputs }), /must be valid JSON/);

  const missingData = createOpenAICompatibleEmbedder({
    fetch: createFetch({ body: { embeddings: [] } }),
    base_url: 'https://api.example.test/v1',
    api_key: apiKey
  });
  await assert.rejects(missingData({ model_id: modelId, dimensions: 3, inputs }), /must contain a data array/);

  const tooMany = createOpenAICompatibleEmbedder({
    fetch: createFetch({ body: embedderBody(['a', 'b']) }),
    base_url: 'https://api.example.test/v1',
    api_key: apiKey
  });
  await assert.rejects(tooMany({ model_id: modelId, dimensions: 3, inputs }), /one vector per input/);

  const wrongDimension = createOpenAICompatibleEmbedder({
    fetch: createFetch({ body: embedderBody(inputs, 2) }),
    base_url: 'https://api.example.test/v1',
    api_key: apiKey
  });
  await assert.rejects(
    wrongDimension({ model_id: modelId, dimensions: 3, inputs }),
    /exactly 3 dimensions/
  );

  const brokenValues = createOpenAICompatibleEmbedder({
    fetch: createFetch({ body: { data: [{ index: 0, embedding: [1, Number.NaN, 0] }] } }),
    base_url: 'https://api.example.test/v1',
    api_key: apiKey
  });
  await assert.rejects(brokenValues({ model_id: modelId, dimensions: 3, inputs }), /finite numbers/);
});

test('rejects malformed call input before any request', async () => {
  const fetch = createFetch({ body: embedderBody(['alpha one.']) });
  const embed = createOpenAICompatibleEmbedder({ fetch, base_url: 'https://api.example.test/v1' });

  await assert.rejects(embed(), /input must be an object/);
  await assert.rejects(embed({ model_id: '', dimensions: 3, inputs: ['alpha one.'] }), /model_id must be non-empty text/);
  await assert.rejects(embed({ model_id: modelId, dimensions: 0, inputs: ['alpha one.'] }), /dimensions must be an integer/);
  await assert.rejects(embed({ model_id: modelId, dimensions: 3, inputs: [] }), /inputs must be a non-empty array/);
  await assert.rejects(embed({ model_id: modelId, dimensions: 3, inputs: [''] }), /inputs\[0\] must be non-empty text/);
  assert.deepEqual(fetch.calls, []);
});

test('hardening: rejects credential URLs, plaintext off-host, and unprintable keys', async () => {
  const fetch = createFetch({ body: embedderBody(['alpha one.']) });
  assert.throws(
    () => createOpenAICompatibleEmbedder({ fetch, base_url: 'https://user:pass@api.example.test/v1', api_key: apiKey }),
    /must not contain credentials/
  );
  assert.throws(
    () => createOpenAICompatibleEmbedder({ fetch, base_url: 'http://embeddings.example.test/v1' }),
    /must use https unless the host is loopback/
  );
  assert.throws(
    () => createOpenAICompatibleEmbedder({ fetch, base_url: 'https://api.example.test/v1', api_key: `sk-${'\n'}leaked` }),
    /api_key must be printable ASCII text/
  );
  const loopback = createOpenAICompatibleEmbedder({ fetch, base_url: 'http://[::1]:8080/v1' });
  await loopback({ model_id: modelId, dimensions: 3, inputs: ['alpha one.'] });
  assert.equal(fetch.calls[0].url, 'http://[::1]:8080/v1/embeddings');
  const withQuery = createOpenAICompatibleEmbedder({ fetch, base_url: 'https://api.example.test/v1?ignored=1#fragment', api_key: apiKey });
  await withQuery({ model_id: modelId, dimensions: 3, inputs: ['alpha one.'] });
  assert.equal(fetch.calls[1].url, 'https://api.example.test/v1/embeddings');
});

test('hardening: transport failures and index defects fail closed', async () => {
  const inputs = ['alpha one.'];
  const timedOut = createOpenAICompatibleEmbedder({
    fetch: async () => {
      const error = new Error('aborted');
      error.name = 'TimeoutError';
      throw error;
    },
    base_url: 'https://api.example.test/v1',
    api_key: apiKey
  });
  await assert.rejects(timedOut({ model_id: modelId, dimensions: 3, inputs }), /embedding request timed out/);

  const refused = createOpenAICompatibleEmbedder({
    fetch: async () => {
      const error = new Error('connect ECONNREFUSED 127.0.0.1:1');
      error.code = 'ECONNREFUSED';
      throw error;
    },
    base_url: 'https://api.example.test/v1',
    api_key: apiKey
  });
  await assert.rejects(refused({ model_id: modelId, dimensions: 3, inputs }), (error) => {
    assert.match(error.message, /embedding request failed \(ECONNREFUSED\)/);
    assert.doesNotMatch(error.message, /sk-test-secret-value/);
    return true;
  });

  const leakedCode = createOpenAICompatibleEmbedder({
    fetch: async () => {
      const error = new Error('boom');
      error.code = 'sk-test-secret-value';
      throw error;
    },
    base_url: 'https://api.example.test/v1',
    api_key: apiKey
  });
  await assert.rejects(leakedCode({ model_id: modelId, dimensions: 3, inputs }), (error) => {
    assert.equal(error.message, 'embedding request failed');
    assert.doesNotMatch(error.message, /sk-test-secret-value/);
    return true;
  });

  const duplicatedIndex = createOpenAICompatibleEmbedder({
    fetch: createFetch({ body: { data: [{ index: 0, embedding: [1, 0, 0] }, { index: 0, embedding: [0, 1, 0] }] } }),
    base_url: 'https://api.example.test/v1',
    api_key: apiKey
  });
  await assert.rejects(
    duplicatedIndex({ model_id: modelId, dimensions: 3, inputs: ['a', 'b'] }),
    /indexes must be a permutation of the input order/
  );

  const partiallyIndexed = createOpenAICompatibleEmbedder({
    fetch: createFetch({ body: { data: [{ embedding: [1, 0, 0] }, { index: 0, embedding: [0, 1, 0] }] } }),
    base_url: 'https://api.example.test/v1',
    api_key: apiKey
  });
  await assert.rejects(
    partiallyIndexed({ model_id: modelId, dimensions: 3, inputs: ['a', 'b'] }),
    /must index every vector when it indexes any/
  );
});

test('composes with the backfill worker end to end', async () => {
  const inputs = ['alpha one.', 'beta two.'];
  const fetch = createFetch({ body: embedderBody(inputs) });
  const embed = createOpenAICompatibleEmbedder({ fetch, base_url: 'https://api.example.test/v1', api_key: apiKey });
  const saved = [];
  const storage = {
    async listEmbeddingBackfill() {
      return {
        model_id: modelId,
        owner_id: 'owner-a',
        status: 'active',
        dimensions: 3,
        documents: [{ document_id: 'urn:document:worker', segment_ids: ['s0', 's1'], missing_segment_ids: ['s0', 's1'], dimension_mismatch_segment_ids: [] }]
      };
    },
    async getDocumentWithSegments() {
      return {
        document_id: 'urn:document:worker',
        created_at: '2026-01-01T00:00:00Z',
        retention: { owner_id: 'owner-a', state: 'active' },
        segments: [
          { id: 's0', text: inputs[0] },
          { id: 's1', text: inputs[1] }
        ]
      };
    },
    async saveSegmentEmbeddings(input) {
      saved.push(input);
    }
  };

  const result = await runEmbeddingBackfill({ storage, embed, model_id: modelId, owner_id: 'owner-a' });

  assert.deepEqual(result, {
    model_id: modelId,
    owner_id: 'owner-a',
    dimensions: 3,
    processed_documents: 1,
    embedded_segments: 2,
    skipped_documents: []
  });
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].embeddings, [
    { segment_id: 's0', embedding: vectorsFor(inputs)[0] },
    { segment_id: 's1', embedding: vectorsFor(inputs)[1] }
  ]);
  assert.equal(fetch.calls[0].init.headers.authorization, `Bearer ${apiKey}`);
});
