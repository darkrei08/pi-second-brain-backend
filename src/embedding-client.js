const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TIMEOUT_MS = 600000;
const MAX_VECTOR_DIMENSIONS = 16000;
const LOOPBACK_HOSTS = new Set(['localhost', '[::1]', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_IPV4_PATTERN = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const LOOPBACK_MAPPED_IPV4_PATTERN = /^\[::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}\]$/;
const PRINTABLE_ASCII_PATTERN = /^[\x21-\x7e]+$/;

function requireNonEmptyText(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be non-empty text`);
  }
}

function requireObject(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
}

function isLoopbackHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/\.$/, '');
  return LOOPBACK_HOSTS.has(normalized) ||
    LOOPBACK_IPV4_PATTERN.test(normalized) ||
    LOOPBACK_MAPPED_IPV4_PATTERN.test(normalized);
}

function resolveEndpoint(base_url) {
  requireNonEmptyText(base_url, 'base_url');
  let url;
  try {
    url = new URL(base_url);
  } catch {
    throw new TypeError('base_url must be an absolute http or https URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('base_url must be an absolute http or https URL');
  }
  if (url.username || url.password) {
    throw new TypeError('base_url must not contain credentials');
  }
  // Corpus text must never travel in cleartext off this host.
  if (url.protocol === 'http:' && !isLoopbackHostname(url.hostname)) {
    throw new TypeError('base_url must use https unless the host is loopback');
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}/embeddings`;
}

function validateCallInput(input) {
  requireObject(input, 'input');
  requireNonEmptyText(input.model_id, 'model_id');
  const { dimensions, inputs } = input;
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > MAX_VECTOR_DIMENSIONS) {
    throw new TypeError(`dimensions must be an integer between 1 and ${MAX_VECTOR_DIMENSIONS}`);
  }
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new TypeError('inputs must be a non-empty array');
  }
  inputs.forEach((value, index) => requireNonEmptyText(value, `inputs[${index}]`));
  return { model_id: input.model_id, dimensions, inputs };
}

function orderVectors(data) {
  const anyIndexed = data.some((entry) => entry && entry.index !== undefined);
  if (!anyIndexed) {
    return data;
  }
  if (data.some((entry) => !entry || !Number.isInteger(entry.index))) {
    throw new Error('embedding response must index every vector when it indexes any');
  }
  const ordered = [...data].sort((left, right) => left.index - right.index);
  const isPermutation = ordered.every((entry, position) => entry.index === position);
  if (!isPermutation) {
    throw new Error('embedding response indexes must be a permutation of the input order');
  }
  return ordered;
}

function validateVectors(data, { dimensions, inputs }) {
  const ordered = orderVectors(data);
  if (ordered.length !== inputs.length) {
    throw new Error('embedding response must contain one vector per input');
  }
  return ordered.map((entry) => {
    const embedding = entry && entry.embedding;
    if (!Array.isArray(embedding) || embedding.length !== dimensions) {
      throw new Error(`embedding response vectors must have exactly ${dimensions} dimensions`);
    }
    if (embedding.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
      throw new Error('embedding response vectors must contain finite numbers');
    }
    return embedding;
  });
}

export function createOpenAICompatibleEmbedder({ fetch = globalThis.fetch, base_url, api_key, timeout_ms = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof fetch !== 'function') {
    throw new TypeError('fetch must be a function');
  }
  const endpoint = resolveEndpoint(base_url);
  if (api_key !== undefined) {
    requireNonEmptyText(api_key, 'api_key');
    if (!PRINTABLE_ASCII_PATTERN.test(api_key)) {
      throw new TypeError('api_key must be printable ASCII text');
    }
  }
  if (!Number.isInteger(timeout_ms) || timeout_ms < 1 || timeout_ms > MAX_TIMEOUT_MS) {
    throw new TypeError(`timeout_ms must be an integer between 1 and ${MAX_TIMEOUT_MS}`);
  }

  return async function embed(input) {
    const { model_id, dimensions, inputs } = validateCallInput(input);
    const headers = { 'content-type': 'application/json' };
    if (api_key !== undefined) {
      headers.authorization = `Bearer ${api_key}`;
    }
    const response = await (async () => {
      try {
        return await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({ model: model_id, input: inputs }),
          // A redirect could forward the corpus to another origin.
          redirect: 'error',
          signal: AbortSignal.timeout(timeout_ms)
        });
      } catch (error) {
        if (error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
          throw new Error('embedding request timed out');
        }
        const code = error && typeof error.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(error.code)
          ? ` (${error.code})`
          : '';
        throw new Error(`embedding request failed${code}`);
      }
    })();
    if (!response.ok) {
      // Never echo the request, the response body, or the key in an error.
      throw new Error(`embedding request failed with status ${response.status}`);
    }
    let body;
    try {
      body = await response.json();
    } catch {
      throw new Error('embedding response must be valid JSON');
    }
    if (!body || !Array.isArray(body.data)) {
      throw new Error('embedding response must contain a data array');
    }
    return validateVectors(body.data, { dimensions, inputs });
  };
}
