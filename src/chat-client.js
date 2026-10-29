const DEFAULT_TIMEOUT_MS = 60000;
const MAX_TIMEOUT_MS = 600000;
const MAX_COMPLETION_TOKENS = 8192;
const LOOPBACK_HOSTS = new Set(['localhost', '[::1]', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_IPV4_PATTERN = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const LOOPBACK_MAPPED_IPV4_PATTERN = /^\[::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}\]$/;
const PRINTABLE_ASCII_PATTERN = /^[\x21-\x7e]+$/;
const ROLES = new Set(['system', 'user', 'assistant']);

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
  // Evidence and answers must never travel in cleartext off this host.
  if (url.protocol === 'http:' && !isLoopbackHostname(url.hostname)) {
    throw new TypeError('base_url must use https unless the host is loopback');
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}/chat/completions`;
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new TypeError('messages must be a non-empty array');
  }
  return messages.map((message, index) => {
    requireObject(message, `messages[${index}]`);
    if (!ROLES.has(message.role)) {
      throw new TypeError(`messages[${index}].role must be system, user, or assistant`);
    }
    requireNonEmptyText(message.content, `messages[${index}].content`);
    return { role: message.role, content: message.content };
  });
}

function validateCallInput(input) {
  requireObject(input, 'input');
  requireNonEmptyText(input.model_id, 'model_id');
  const messages = validateMessages(input.messages);
  const max_tokens = input.max_tokens ?? 1024;
  if (!Number.isInteger(max_tokens) || max_tokens < 1 || max_tokens > MAX_COMPLETION_TOKENS) {
    throw new TypeError(`max_tokens must be an integer between 1 and ${MAX_COMPLETION_TOKENS}`);
  }
  return { model_id: input.model_id, messages, max_tokens };
}

function readContent(body) {
  const choices = body && body.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error('chat response must contain at least one choice');
  }
  const message = choices[0] && choices[0].message;
  if (message === null || typeof message !== 'object' || typeof message.content !== 'string') {
    throw new Error('chat response must contain message content');
  }
  if (message.content.trim().length === 0) {
    throw new Error('chat response content must not be empty');
  }
  return message.content;
}

export function createOpenAICompatibleChat({ fetch = globalThis.fetch, base_url, api_key, timeout_ms = DEFAULT_TIMEOUT_MS } = {}) {
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

  return async function chat(input) {
    const { model_id, messages, max_tokens } = validateCallInput(input);
    const headers = { 'content-type': 'application/json' };
    if (api_key !== undefined) {
      headers.authorization = `Bearer ${api_key}`;
    }
    const response = await (async () => {
      try {
        return await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({ model: model_id, messages, max_tokens, temperature: 0 }),
          // A redirect could forward the evidence to another origin.
          redirect: 'error',
          signal: AbortSignal.timeout(timeout_ms)
        });
      } catch (error) {
        if (error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
          throw new Error('chat request timed out');
        }
        const code = error && typeof error.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(error.code)
          ? ` (${error.code})`
          : '';
        throw new Error(`chat request failed${code}`);
      }
    })();
    if (!response.ok) {
      // Never echo the request, the response body, or the key in an error.
      throw new Error(`chat request failed with status ${response.status}`);
    }
    let body;
    try {
      body = await response.json();
    } catch {
      throw new Error('chat response must be valid JSON');
    }
    return readContent(body);
  };
}
