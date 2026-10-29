import { createServer } from 'node:http';

import { GatewayError, errorPayload } from './gateway-error.js';
import { describeRetrievalMode, segmentDocument } from './index.js';

export const MAX_BODY_BYTES = 1024 * 1024;
const MAX_CITATION_BATCH = 100;
const JSON_CONTENT_TYPE = /^application\/json(?:;|$)/iu;
const UNAUTHENTICATED_PATHS = new Set(['/healthz', '/readyz']);

function requireJsonBody(request) {
  const contentType = request.headers['content-type'];
  if (typeof contentType !== 'string' || !JSON_CONTENT_TYPE.test(contentType)) {
    throw new GatewayError(415, 'unsupported_media_type', 'Content-Type must be application/json');
  }
}

async function readJsonBody(request, limit) {
  requireJsonBody(request);
  const declared = request.headers['content-length'];
  if (declared !== undefined) {
    if (!/^\d+$/u.test(declared)) {
      throw new GatewayError(400, 'invalid_request', 'Content-Length must be a byte count');
    }
    if (Number(declared) > limit) {
      throw new GatewayError(413, 'body_too_large', `The body exceeds ${limit} bytes`);
    }
  }
  const chunks = [];
  let received = 0;
  for await (const chunk of request) {
    received += chunk.length;
    if (received > limit) {
      throw new GatewayError(413, 'body_too_large', `The body exceeds ${limit} bytes`);
    }
    chunks.push(chunk);
  }
  if (received === 0) {
    throw new GatewayError(400, 'invalid_json', 'A JSON body is required');
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new GatewayError(400, 'invalid_json', 'The body is not valid JSON');
  }
}

function requireObject(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new GatewayError(400, 'invalid_request', `${name} must be an object`);
  }
  return value;
}

function rejectCallerOwner(body) {
  if (Object.hasOwn(body, 'owner_id')) {
    throw new GatewayError(400, 'invalid_request', 'owner_id is derived from the authenticated caller');
  }
}

function optionalCollectionIds(body) {
  if (body.collection_ids === undefined) return undefined;
  if (!Array.isArray(body.collection_ids) || body.collection_ids.length === 0) {
    throw new GatewayError(400, 'invalid_request', 'collection_ids must be a non-empty array');
  }
  return body.collection_ids;
}

function send(response, status, payload, extraHeaders = {}) {
  const serialized = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(serialized),
    'cache-control': 'no-store',
    ...extraHeaders
  });
  response.end(serialized);
}

export function createGatewayServer({ storage, authenticator, embed, max_body_bytes = MAX_BODY_BYTES } = {}) {
  if (storage === undefined || storage === null) {
    throw new TypeError('storage is required');
  }
  if (authenticator === undefined || authenticator === null || typeof authenticator.authenticate !== 'function') {
    throw new TypeError('authenticator is required');
  }
  if (embed !== undefined && typeof embed !== 'function') {
    throw new TypeError('embed must be a function when provided');
  }
  if (!Number.isInteger(max_body_bytes) || max_body_bytes < 1) {
    throw new TypeError('max_body_bytes must be a positive integer');
  }

  const handlers = {
    'GET /healthz': () => ({ status: 200, body: { status: 'ok' } }),

    'GET /readyz': async () => {
      try {
        await storage.listEmbeddingModels();
      } catch {
        throw new GatewayError(503, 'not_ready', 'Storage is not reachable');
      }
      return { status: 200, body: { status: 'ready' } };
    },

    'POST /v1/retrieval/query': async ({ body, owner_id }) => {
      const mode = body.mode ?? 'lexical';
      const collection_ids = optionalCollectionIds(body);
      const limit = body.limit;
      if (mode === 'lexical') {
        const matches = await storage.searchSegmentsLexical({
          query: body.query,
          owner_id,
          limit: limit ?? 20,
          collection_ids
        });
        return { status: 200, body: { mode: describeRetrievalMode(matches), matches } };
      }
      if (mode !== 'hybrid') {
        throw new GatewayError(400, 'invalid_request', 'mode must be lexical or hybrid');
      }
      const model_id = body.model_id;
      if (typeof model_id !== 'string' || model_id === '') {
        throw new GatewayError(400, 'invalid_request', 'model_id is required for hybrid retrieval');
      }
      let query_embedding = body.query_embedding;
      if (query_embedding === undefined) {
        if (embed === undefined) {
          throw new GatewayError(400, 'invalid_request', 'query_embedding is required when no embedder is configured');
        }
        const model = await storage.getEmbeddingModel(model_id);
        if (model === null) {
          throw new GatewayError(400, 'invalid_request', 'model_id is not registered');
        }
        const vectors = await embed({ model_id, dimensions: model.dimensions, inputs: [body.query] });
        query_embedding = vectors[0];
      }
      const matches = await storage.searchSegmentsHybrid({
        query: body.query,
        query_embedding,
        model_id,
        owner_id,
        limit: limit ?? 20,
        collection_ids
      });
      return { status: 200, body: { mode: describeRetrievalMode(matches, { model_id }), matches } };
    },

    'POST /v1/citations/resolve': async ({ body, owner_id }) => {
      if (!Array.isArray(body.citations) || body.citations.length === 0 || body.citations.length > MAX_CITATION_BATCH) {
        throw new GatewayError(400, 'invalid_request', `citations must be an array of 1 to ${MAX_CITATION_BATCH} entries`);
      }
      const result = await storage.revalidateCitations(body.citations, { owner_id });
      return { status: 200, body: result };
    },

    'GET /v1/models': async ({ query, owner_id }) => {
      const models = await storage.listEmbeddingModels();
      const requested = query.get('model_id');
      const payload = { models };
      if (requested !== null) {
        payload.coverage = await storage.inspectEmbeddingCoverage({ model_id: requested, owner_id });
      }
      return { status: 200, body: payload };
    },

    'POST /v1/documents/ingest': async ({ body, owner_id }) => {
      const document = requireObject(body.document, 'document');
      if (document.retention !== undefined) {
        requireObject(document.retention, 'document.retention');
        rejectCallerOwner(document.retention);
      }
      const owned = Object.freeze({ ...document, retention: { owner_id, state: 'active' } });
      const result = segmentDocument(owned, { max_segment_chars: body.max_segment_chars ?? 1200 });
      await storage.saveDocumentAndSegments(owned, result);
      return {
        status: 200,
        body: {
          document_id: owned.document_id,
          collections: await storage.listDocumentCollections(owned.document_id, owner_id),
          segments: result.segments.length
        }
      };
    }
  };

  const paths = new Map();
  for (const route of Object.keys(handlers)) {
    const [method, path] = route.split(' ');
    if (!paths.has(path)) paths.set(path, new Set());
    paths.get(path).add(method);
  }

  async function handle(request, response) {
    const url = new URL(request.url ?? '/', 'http://gateway.invalid');
    const allowed = paths.get(url.pathname);
    if (allowed === undefined) {
      throw new GatewayError(404, 'not_found', 'No such route');
    }
    const handler = handlers[`${request.method} ${url.pathname}`];
    if (handler === undefined) {
      const error = new GatewayError(405, 'method_not_allowed', 'That method is not supported for this route');
      error.headers = { allow: [...allowed].join(', ') };
      throw error;
    }
    if (!UNAUTHENTICATED_PATHS.has(url.pathname)) {
      const { owner_id } = authenticator.authenticate(request.headers);
      if (request.method === 'POST') {
        const body = await readJsonBody(request, max_body_bytes);
        requireObject(body, 'body');
        rejectCallerOwner(body);
        return await handler({ body, query: url.searchParams, owner_id });
      }
      return await handler({ body: {}, query: url.searchParams, owner_id });
    }
    return await handler({ body: {}, query: url.searchParams, owner_id: null });
  }

  const server = createServer((request, response) => {
    handle(request, response)
      .then((result) => send(response, result.status, result.body))
      .catch((error) => {
        const { status, body } = errorPayload(error);
        const headers = error instanceof GatewayError && error.headers ? error.headers : {};
        if (response.headersSent) {
          response.destroy();
          return;
        }
        send(response, status, body, headers);
      });
  });
  server.headersTimeout = 5000;
  server.requestTimeout = 15000;
  server.maxHeadersCount = 64;

  return Object.freeze({
    server,
    handler: (request, response) => handle(request, response),
    async start({ port = 0, host = '127.0.0.1' } = {}) {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, resolve);
      });
      const address = server.address();
      return { host, port: address.port, url: `http://${host}:${address.port}` };
    },
    async stop() {
      if (!server.listening) return;
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
}
