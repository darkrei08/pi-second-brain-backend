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
