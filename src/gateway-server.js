import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

import { answerQuestion, researchQuestion } from './answer-question.js';
import { GatewayError, errorPayload } from './gateway-error.js';
import { describeRetrievalMode, segmentDocument } from './index.js';
import { OPAQUE_ID_PATTERN } from './opaque-id.js';

export const MAX_BODY_BYTES = 1024 * 1024;
const MAX_CITATION_BATCH = 100;
const MODEL_ROUTES = new Set(['POST /v1/answers', 'POST /v1/research', 'POST /v1/chat/completions']);
const MODEL_WINDOW_MS = 60_000;
const READINESS_CACHE_MS = 30_000;
const JSON_CONTENT_TYPE = /^application\/json(?:;|$)/iu;
const UNAUTHENTICATED_PATHS = new Set(['/healthz', '/readyz']);
const CHAT_COMPLETION_FIELDS = new Set(['model', 'messages', 'stream', 'collection_ids', 'embedding_model_id', 'limit', 'max_tokens']);
const RESEARCH_FIELDS = new Set(['question', 'collection_ids', 'embedding_model_id', 'limit', 'max_tokens']);
// Seam errors with a stable message that means the caller sent something unusable.
const SEAM_FAILURES = [
  { pattern: /^embedding model is not registered$/u, status: 400, code: 'invalid_request' },
  { pattern: /^unknown or foreign collection for this owner$/u, status: 400, code: 'invalid_request' },
  { pattern: /^document belongs to a different owner$/u, status: 409, code: 'conflict' },
  { pattern: /^chat request timed out$/u, status: 504, code: 'model_timeout' },
  { pattern: /^chat request failed/u, status: 502, code: 'model_failed' },
  { pattern: /^chat response /u, status: 502, code: 'model_failed' },
  { pattern: /^embedding request timed out$/u, status: 504, code: 'model_timeout' },
  { pattern: /^embedding request failed/u, status: 502, code: 'model_failed' },
  { pattern: /^embedding response /u, status: 502, code: 'model_failed' }
];

function mapSeamFailure(error) {
  if (!(error instanceof Error)) return null;
  for (const failure of SEAM_FAILURES) {
    if (failure.pattern.test(error.message)) {
      return new GatewayError(failure.status, failure.code, error.message);
    }
  }
  return null;
}

function sanitizeStreamFailure(error) {
  const mapped = mapSeamFailure(error);
  if (mapped?.code === 'model_timeout') {
    return new GatewayError(504, mapped.code, 'The model request timed out');
  }
  if (mapped?.code === 'model_failed') {
    return new GatewayError(502, mapped.code, 'The model request failed');
  }
  return error;
}

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

function optionalCollectionIds(body, field = 'collection_ids') {
  if (body[field] === undefined) return undefined;
  if (!Array.isArray(body[field])) {
    throw new GatewayError(400, 'invalid_request', `${field} must be an array of opaque collection ids`);
  }
  const unique = [];
  for (const [index, collection_id] of body[field].entries()) {
    if (typeof collection_id !== 'string' || !OPAQUE_ID_PATTERN.test(collection_id)) {
      throw new GatewayError(400, 'invalid_request', `${field}[${index}] must be an opaque collection id`);
    }
    if (!unique.includes(collection_id)) unique.push(collection_id);
  }
  return unique;
}

function researchRequest(body) {
  for (const key of Object.keys(body)) {
    if (!RESEARCH_FIELDS.has(key)) {
      throw new GatewayError(400, 'invalid_request', `Unsupported research field: ${key}`);
    }
  }
  if (body.limit !== undefined && (!Number.isInteger(body.limit) || body.limit < 1 || body.limit > 100)) {
    throw new GatewayError(400, 'invalid_request', 'limit must be an integer between 1 and 100');
  }
  if (body.max_tokens !== undefined && (!Number.isInteger(body.max_tokens) || body.max_tokens < 1 || body.max_tokens > 8192)) {
    throw new GatewayError(400, 'invalid_request', 'max_tokens must be an integer between 1 and 8192');
  }
  if (body.embedding_model_id !== undefined && (typeof body.embedding_model_id !== 'string' || body.embedding_model_id.trim() === '')) {
    throw new GatewayError(400, 'invalid_request', 'embedding_model_id must be non-empty text');
  }
}

function chatCompletionQuestion(body) {
  for (const key of Object.keys(body)) {
    if (!CHAT_COMPLETION_FIELDS.has(key)) {
      throw new GatewayError(400, 'invalid_request', `Unsupported chat completion field: ${key}`);
    }
  }
  if (typeof body.model !== 'string' || body.model.trim() === '') {
    throw new GatewayError(400, 'invalid_request', 'model must be non-empty text');
  }
  if (body.stream !== undefined && typeof body.stream !== 'boolean') {
    throw new GatewayError(400, 'invalid_request', 'stream must be a boolean');
  }
  if (body.limit !== undefined && (!Number.isInteger(body.limit) || body.limit < 1 || body.limit > 100)) {
    throw new GatewayError(400, 'invalid_request', 'limit must be an integer between 1 and 100');
  }
  if (body.max_tokens !== undefined && (!Number.isInteger(body.max_tokens) || body.max_tokens < 1 || body.max_tokens > 8192)) {
    throw new GatewayError(400, 'invalid_request', 'max_tokens must be an integer between 1 and 8192');
  }
  if (body.embedding_model_id !== undefined && (typeof body.embedding_model_id !== 'string' || body.embedding_model_id.trim() === '')) {
    throw new GatewayError(400, 'invalid_request', 'embedding_model_id must be non-empty text');
  }
  if (!Array.isArray(body.messages) || body.messages.length !== 1) {
    throw new GatewayError(400, 'invalid_request', 'messages must contain exactly one user message');
  }
  const [message] = body.messages;
  if (message === null || typeof message !== 'object' || Array.isArray(message) || message.role !== 'user' || typeof message.content !== 'string' || message.content.trim() === '') {
    throw new GatewayError(400, 'invalid_request', 'messages must contain exactly one non-empty user message');
  }
  return message.content;
}

function answerMetadata(answer) {
  return {
    citations: answer.citations,
    unresolved_citations: answer.unresolved_citations,
    stale_citations: answer.stale_citations,
    retrieval: answer.retrieval,
    uncertainty: answer.uncertainty
  };
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

function writeChatChunk(response, chunk) {
  if (!response.headersSent) {
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    });
  }
  response.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

export function createGatewayServer({
  storage,
  authenticator,
  embed,
  chat,
  answer_model,
  max_body_bytes = MAX_BODY_BYTES,
  max_model_concurrency = 4,
  model_requests_per_minute = 60,
  audit,
  trace = (event) => process.stderr.write(`${JSON.stringify(event)}\n`)
} = {}) {
  if (storage === undefined || storage === null) {
    throw new TypeError('storage is required');
  }
  if (authenticator === undefined || authenticator === null || typeof authenticator.authenticate !== 'function') {
    throw new TypeError('authenticator is required');
  }
  if (embed !== undefined && typeof embed !== 'function') {
    throw new TypeError('embed must be a function when provided');
  }
  if (chat !== undefined && typeof chat !== 'function') {
    throw new TypeError('chat must be a function when provided');
  }
  if (answer_model !== undefined && (typeof answer_model !== 'string' || answer_model.trim() === '')) {
    throw new TypeError('answer_model must be non-empty text when provided');
  }
  if (!Number.isInteger(max_body_bytes) || max_body_bytes < 1) {
    throw new TypeError('max_body_bytes must be a positive integer');
  }
  if (!Number.isSafeInteger(max_model_concurrency) || max_model_concurrency < 1 || max_model_concurrency > 64) {
    throw new TypeError('max_model_concurrency must be an integer between 1 and 64');
  }
  if (!Number.isSafeInteger(model_requests_per_minute) || model_requests_per_minute < 1 || model_requests_per_minute > 60000) {
    throw new TypeError('model_requests_per_minute must be an integer between 1 and 60000');
  }
  if (audit !== undefined && typeof audit !== 'function') {
    throw new TypeError('audit must be a function when provided');
  }
  if (typeof trace !== 'function') {
    throw new TypeError('trace must be a function when provided');
  }

  let active_model_requests = 0;
  let answer_provider_readiness = { checked_at: null, ready: false };
  const owner_budgets = new Map();
  const acquireModelSlot = (owner_id) => {
    const now = Date.now();
    for (const [budget_owner, budget] of owner_budgets) {
      if (now - budget.window_started_at >= MODEL_WINDOW_MS) owner_budgets.delete(budget_owner);
    }
    const budget = owner_budgets.get(owner_id);
    if (active_model_requests >= max_model_concurrency || (budget?.requests ?? 0) >= model_requests_per_minute) {
      throw new GatewayError(429, 'model_busy', 'Model capacity is temporarily unavailable');
    }
    active_model_requests += 1;
    if (budget === undefined) owner_budgets.set(owner_id, { window_started_at: now, requests: 1 });
    else budget.requests += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active_model_requests -= 1;
    };
  };

  // One audit event per call that reaches a provider. Only metadata leaves this seam: the sink
  // must never receive question, evidence, answer, or citation text.
  const recordModelCall = async (kind, route, owner_id, model_id, call) => {
    const started_at = Date.now();
    let outcome = 'failed';
    try {
      const result = await call();
      outcome = 'ok';
      return result;
    } finally {
      if (audit !== undefined) {
        try {
          audit(Object.freeze({ event: 'model_call', kind, route, owner_id, model_id, outcome, duration_ms: Date.now() - started_at }));
        } catch {
          //NOTE: a broken sink must not fail or mask a request that already reached the provider.
        }
      }
    }
  };

  const handlers = {
    'GET /healthz': () => ({ status: 200, body: { status: 'ok' } }),

    'GET /readyz': async () => {
      try {
        await storage.listEmbeddingModels();
      } catch {
        throw new GatewayError(503, 'not_ready', 'Storage is not reachable');
      }
      if (chat === undefined || answer_model === undefined || typeof chat.probe !== 'function') {
        throw new GatewayError(503, 'not_ready', 'Answer provider is not configured');
      }
      const checked_at = answer_provider_readiness.checked_at;
      if (checked_at === null || Date.now() - checked_at >= READINESS_CACHE_MS) {
        try {
          await chat.probe(answer_model);
          answer_provider_readiness = Object.freeze({ checked_at: Date.now(), ready: true });
        } catch {
          answer_provider_readiness = Object.freeze({ checked_at: Date.now(), ready: false });
          // The cached provider verdict below is the sanitized readiness response.
        }
      }
      if (!answer_provider_readiness.ready) {
        throw new GatewayError(503, 'not_ready', 'Answer provider is not reachable');
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
        return { status: 200, body: { retrieval: describeRetrievalMode(matches), matches } };
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
        const vectors = await recordModelCall('embedding', 'POST /v1/retrieval/query', owner_id, model_id, () =>
          embed({ model_id, dimensions: model.dimensions, inputs: [body.query] }));
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
      return { status: 200, body: { retrieval: describeRetrievalMode(matches, { model_id }), matches } };
    },

    'POST /v1/citations/resolve': async ({ body, owner_id }) => {
      if (!Array.isArray(body.citations) || body.citations.length === 0 || body.citations.length > MAX_CITATION_BATCH) {
        throw new GatewayError(400, 'invalid_request', `citations must be an array of 1 to ${MAX_CITATION_BATCH} entries`);
      }
      const result = await storage.revalidateCitations(body.citations, { owner_id });
      return { status: 200, body: result };
    },

    'POST /v1/answers': async ({ body, owner_id }) => {
      if (chat === undefined || answer_model === undefined) {
        throw new GatewayError(503, 'answers_unavailable', 'No answer model is configured');
      }
      const answer = await recordModelCall('chat', 'POST /v1/answers', owner_id, answer_model, () => answerQuestion({
        storage,
        chat,
        embed,
        question: body.question,
        owner_id,
        collection_ids: optionalCollectionIds(body),
        // The chat model and the embedding model are different models with different identities.
        model_id: answer_model,
        embedding_model_id: embed === undefined ? undefined : body.embedding_model_id,
        limit: body.limit ?? 6,
        max_tokens: body.max_tokens ?? 600
      }));
      return { status: 200, body: answer };
    },

    'POST /v1/research': async ({ body, owner_id }) => {
      if (chat === undefined || answer_model === undefined) {
        throw new GatewayError(503, 'answers_unavailable', 'No answer model is configured');
      }
      researchRequest(body);
      const answer = await recordModelCall('chat', 'POST /v1/research', owner_id, answer_model, () => researchQuestion({
        storage,
        chat,
        embed,
        question: body.question,
        owner_id,
        collection_ids: optionalCollectionIds(body),
        model_id: answer_model,
        embedding_model_id: embed === undefined ? undefined : body.embedding_model_id,
        limit: body.limit ?? 6,
        max_tokens: body.max_tokens ?? 600
      }));
      return { status: 200, body: answer };
    },

    'POST /v1/chat/completions': async ({ body, owner_id, response }) => {
      if (chat === undefined || answer_model === undefined) {
        throw new GatewayError(503, 'answers_unavailable', 'No answer model is configured');
      }
      const question = chatCompletionQuestion(body);
      const input = {
        storage,
        chat,
        embed,
        question,
        owner_id,
        collection_ids: optionalCollectionIds(body),
        model_id: answer_model,
        embedding_model_id: embed === undefined ? undefined : body.embedding_model_id,
        limit: body.limit ?? 6,
        max_tokens: body.max_tokens ?? 600
      };
      if (body.stream !== true) {
        const answer = await recordModelCall('chat', 'POST /v1/chat/completions', owner_id, answer_model, () =>
          answerQuestion(input));
        return {
          status: 200,
          body: {
            id: `chatcmpl-${randomUUID()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: answer_model,
            choices: [{ index: 0, message: { role: 'assistant', content: answer.answer }, finish_reason: 'stop' }],
            answer_metadata: answerMetadata(answer)
          }
        };
      }
      if (typeof chat.stream !== 'function') {
        throw new GatewayError(503, 'answers_unavailable', 'The configured chat provider does not support streaming');
      }
      const abortController = new AbortController();
      const abortOnClose = () => abortController.abort();
      const id = `chatcmpl-${randomUUID()}`;
      const created = Math.floor(Date.now() / 1000);
      let started = false;
      response.once('close', abortOnClose);
      const emit = (delta) => {
        if (response.destroyed || response.writableEnded) {
          abortController.abort();
          return;
        }
        if (!started) {
          started = true;
          writeChatChunk(response, {
            id, object: 'chat.completion.chunk', created, model: answer_model,
            choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }]
          });
        }
        writeChatChunk(response, {
          id, object: 'chat.completion.chunk', created, model: answer_model,
          choices: [{ index: 0, delta: { content: delta }, finish_reason: null }]
        });
      };
      try {
        let answer;
        try {
          answer = await recordModelCall('chat', 'POST /v1/chat/completions', owner_id, answer_model, () =>
            answerQuestion({ ...input, on_delta: emit, signal: abortController.signal }));
        } catch (error) {
          throw sanitizeStreamFailure(error);
        }
        if (response.destroyed || response.writableEnded) return { streamed: true };
        if (!started) emit(answer.answer);
        writeChatChunk(response, {
          id, object: 'chat.completion.chunk', created, model: answer_model,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          answer_metadata: answerMetadata(answer)
        });
        response.write('data: [DONE]\n\n');
        response.end();
        return { streamed: true };
      } finally {
        response.off('close', abortOnClose);
      }
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
      rejectCallerOwner(document);
      if (document.retention !== undefined) {
        requireObject(document.retention, 'document.retention');
        rejectCallerOwner(document.retention);
      }
      const collections = optionalCollectionIds(document, 'collections');
      const owned = Object.freeze({
        ...document,
        ...(collections === undefined ? {} : { collections }),
        retention: { owner_id, state: 'active' }
      });
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
    // Authenticate before routing so an unauthenticated caller cannot map the route table.
    let identity = { owner_id: null };
    if (!UNAUTHENTICATED_PATHS.has(url.pathname)) {
      identity = authenticator.authenticate(request.headers);
    }
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
    if (identity.owner_id !== null) {
      if (request.method === 'POST') {
        const body = await readJsonBody(request, max_body_bytes);
        requireObject(body, 'body');
        rejectCallerOwner(body);
        const route = `${request.method} ${url.pathname}`;
        if (!MODEL_ROUTES.has(route)) {
          return await handler({ body, query: url.searchParams, owner_id: identity.owner_id, response });
        }
        const release = acquireModelSlot(identity.owner_id);
        let keepSlot = false;
        const releaseOnResponseEnd = () => {
          response.off('finish', releaseOnResponseEnd);
          response.off('close', releaseOnResponseEnd);
          release();
        };
        response.once('finish', releaseOnResponseEnd);
        response.once('close', releaseOnResponseEnd);
        try {
          const result = await handler({ body, query: url.searchParams, owner_id: identity.owner_id, response });
          keepSlot = result.streamed === true;
          return result;
        } finally {
          if (!keepSlot) releaseOnResponseEnd();
        }
      }
      return await handler({ body: {}, query: url.searchParams, owner_id: identity.owner_id });
    }
    return await handler({ body: {}, query: url.searchParams, owner_id: null });
  }

  const server = createServer((request, response) => {
    handle(request, response)
      .then((result) => {
        if (result.streamed) return;
        send(response, result.status, result.body);
      })
      .catch((error) => {
        const mapped = mapSeamFailure(error) ?? error;
        if (mapped === error && !(error instanceof GatewayError) && !(error instanceof TypeError)) {
          try {
            trace(Object.freeze({
              event: 'gateway_unexpected_failure',
              route: `${request.method} ${new URL(request.url ?? '/', 'http://gateway.invalid').pathname}`,
              error_class: error?.constructor?.name ?? 'UnknownError'
            }));
          } catch {
            //NOTE: incident tracing must not mask the sanitized response.
          }
        }
        const { status, body } = errorPayload(mapped);
        const headers = mapped instanceof GatewayError && mapped.headers ? mapped.headers : {};
        if (response.destroyed) return;
        if (response.headersSent) {
          const streamError = mapped instanceof GatewayError
            ? body.error
            : { code: 'internal_error', message: 'The request failed' };
          response.write(`data: ${JSON.stringify({ error: streamError })}\n\n`);
          response.end();
          return;
        }
        // An oversized body was refused without reading it, so the connection cannot be reused safely.
        send(response, status, body, status === 413 ? { ...headers, connection: 'close' } : headers);
        if (status === 413) request.destroy();
      });
  });
  server.headersTimeout = 5000;
  // An answer may legitimately wait for the model longer than an ordinary request.
  server.requestTimeout = 120000;
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
