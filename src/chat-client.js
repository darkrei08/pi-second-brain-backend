const DEFAULT_TIMEOUT_MS = 60000;
const MAX_TIMEOUT_MS = 600000;
const READINESS_TIMEOUT_MS = 3000;
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

function resolveBaseEndpoint(base_url, allowed_hosts = []) {
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
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!isLoopbackHostname(hostname) && !allowed_hosts.some((host) => host.toLowerCase().replace(/\.$/, '') === hostname)) {
    throw new TypeError(`provider host ${hostname} is not allowed; set ANSWER_ALLOWED_HOSTS`);
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
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
  if (input.on_usage !== undefined && typeof input.on_usage !== 'function') {
    throw new TypeError('on_usage must be a function when provided');
  }
  return { model_id: input.model_id, messages, max_tokens, on_usage: input.on_usage };
}

function readUsage(body) {
  const usage = body?.usage;
  if (usage === null || typeof usage !== 'object' || Array.isArray(usage)) return undefined;
  const reported = {};
  for (const field of ['prompt_tokens', 'completion_tokens']) {
    if (Number.isSafeInteger(usage[field]) && usage[field] >= 0) reported[field] = usage[field];
  }
  return Object.keys(reported).length === 0 ? undefined : reported;
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

async function* readStreamContent(response, signal, on_usage) {
  if (response.body === null || typeof response.body?.getReader !== 'function') {
    throw new Error('chat response stream is unavailable');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let receivedDone = false;
  let bodyEnded = false;
  try {
    while (!receivedDone) {
      const { done, value } = await reader.read();
      if (done) {
        bodyEnded = true;
        buffer += decoder.decode();
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const boundary = /\r?\n\r?\n/u.exec(buffer);
        if (boundary === null) break;
        const event = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = event.split(/\r?\n/u)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /u, ''))
          .join('\n');
        if (data === '') continue;
        if (data === '[DONE]') {
          receivedDone = true;
          break;
        }
        let payload;
        try {
          payload = JSON.parse(data);
        } catch {
          throw new Error('chat response stream contains invalid JSON');
        }
        if (payload?.error !== undefined) {
          throw new Error('chat response stream failed');
        }
        const usage = readUsage(payload);
        if (usage !== undefined) on_usage?.(usage);
        if (!Array.isArray(payload?.choices)) {
          throw new Error('chat response stream contains invalid choices');
        }
        const content = payload.choices[0]?.delta?.content;
        if (content === undefined || content === null) continue;
        if (typeof content !== 'string') {
          throw new Error('chat response stream contains invalid content');
        }
        if (content !== '') yield content;
      }
    }
    if (!receivedDone) {
      throw new Error('chat response stream ended unexpectedly');
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('chat response stream')) throw error;
    if (signal?.aborted && signal.reason?.name === 'TimeoutError') {
      throw new Error('chat request timed out');
    }
    throw new Error('chat response stream failed');
  } finally {
    if (!bodyEnded) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function createOpenAICompatibleChat({ fetch = globalThis.fetch, base_url, api_key, allowed_hosts = [], timeout_ms = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof fetch !== 'function') {
    throw new TypeError('fetch must be a function');
  }
  const base_endpoint = resolveBaseEndpoint(base_url, allowed_hosts);
  const endpoint = `${base_endpoint}/chat/completions`;
  const models_endpoint = `${base_endpoint}/models`;
  if (api_key !== undefined) {
    requireNonEmptyText(api_key, 'api_key');
    if (!PRINTABLE_ASCII_PATTERN.test(api_key)) {
      throw new TypeError('api_key must be printable ASCII text');
    }
  }
  if (!Number.isInteger(timeout_ms) || timeout_ms < 1 || timeout_ms > MAX_TIMEOUT_MS) {
    throw new TypeError(`timeout_ms must be an integer between 1 and ${MAX_TIMEOUT_MS}`);
  }

  const chat = async function chat(input) {
    const { model_id, messages, max_tokens, on_usage } = validateCallInput(input);
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
    const usage = readUsage(body);
    if (usage !== undefined) on_usage?.(usage);
    return readContent(body);
  };
  chat.probe = async function probe(model_id) {
    requireNonEmptyText(model_id, 'model_id');
    const headers = {};
    if (api_key !== undefined) headers.authorization = `Bearer ${api_key}`;
    let response;
    try {
      response = await fetch(models_endpoint, {
        method: 'GET',
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(READINESS_TIMEOUT_MS)
      });
    } catch (error) {
      if (error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new Error('chat readiness request timed out');
      }
      throw new Error('chat readiness request failed');
    }
    if (!response.ok) {
      throw new Error(`chat readiness request failed with status ${response.status}`);
    }
    let body;
    try {
      body = await response.json();
    } catch {
      throw new Error('chat readiness response must be valid JSON');
    }
    if (!body || !Array.isArray(body.data) || !body.data.some((model) => model && model.id === model_id)) {
      throw new Error('chat model is not available');
    }
  };
  chat.stream = async function* stream(input) {
    const { model_id, messages, max_tokens, on_usage } = validateCallInput(input);
    const headers = { 'content-type': 'application/json' };
    if (api_key !== undefined) headers.authorization = `Bearer ${api_key}`;
    const timeoutSignal = AbortSignal.timeout(timeout_ms);
    const signal = input.signal === undefined ? timeoutSignal : AbortSignal.any([timeoutSignal, input.signal]);
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: model_id, messages, max_tokens, temperature: 0, stream: true }),
        redirect: 'error',
        signal
      });
    } catch (error) {
      if (signal.aborted && signal.reason?.name === 'TimeoutError') {
        throw new Error('chat request timed out');
      }
      const code = error && typeof error.code === 'string' && /^[A-Z0-9_]{1,40}$/u.test(error.code)
        ? ` (${error.code})`
        : '';
      throw new Error(`chat request failed${code}`);
    }
    if (!response.ok) {
      throw new Error(`chat request failed with status ${response.status}`);
    }
    const contentType = response.headers?.get?.('content-type');
    if (typeof contentType !== 'string' || !/^text\/event-stream(?:\s*;|$)/iu.test(contentType)) {
      throw new Error('chat response stream must use text/event-stream');
    }
    yield* readStreamContent(response, signal, on_usage);
  };
  return chat;
}
