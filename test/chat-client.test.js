import assert from 'node:assert/strict';
import test from 'node:test';

import { createOpenAICompatibleChat } from '../src/chat-client.js';

const messages = [{ role: 'user', content: 'Question: where is the invoice?' }];

function respondWith(payload, { status = 200, capture } = {}) {
  return async (url, init) => {
    if (capture) capture(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      async json() {
        return payload;
      }
    };
  };
}

test('posts to the chat completions endpoint with a fixed patch', async () => {
  const calls = [];
  const chat = createOpenAICompatibleChat({
    base_url: 'http://127.0.0.1:11434/v1',
    fetch: respondWith({ choices: [{ message: { content: 'The invoice is on page 2 [1].' } }] }, {
      capture: (url, init) => calls.push({ url, init })
    })
  });
  const answer = await chat({ model_id: 'synthetic-chat', messages, max_tokens: 256 });
  assert.equal(answer, 'The invoice is on page 2 [1].');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:11434/v1/chat/completions');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.redirect, 'error');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    model: 'synthetic-chat',
    messages,
    max_tokens: 256,
    temperature: 0
  });
  assert.equal(calls[0].init.headers.authorization, undefined);
});

test('refuses a non-loopback cleartext endpoint and a malformed configuration', () => {
  const fetch = respondWith({});
  assert.throws(() => createOpenAICompatibleChat({ base_url: 'http://models.example.com/v1', fetch }), /https unless the host is loopback/);
  assert.throws(() => createOpenAICompatibleChat({ base_url: 'ftp://127.0.0.1/v1', fetch }), /absolute http or https/);
  assert.throws(() => createOpenAICompatibleChat({ base_url: 'http://user:pass@127.0.0.1/v1', fetch }), /credentials/);
  assert.throws(() => createOpenAICompatibleChat({ base_url: 'http://127.0.0.1/v1', fetch, api_key: 'not\nascii' }), /printable ASCII/);
  assert.throws(() => createOpenAICompatibleChat({ base_url: 'http://127.0.0.1/v1', fetch, timeout_ms: 0 }), /timeout_ms/);
});

test('rejects malformed input before calling the provider', async () => {
  let called = false;
  const chat = createOpenAICompatibleChat({
    base_url: 'http://127.0.0.1:11434/v1',
    fetch: async () => {
      called = true;
      return { ok: true, status: 200, json: async () => ({}) };
    }
  });
  await assert.rejects(chat({ model_id: '', messages }), /model_id/);
  await assert.rejects(chat({ model_id: 'synthetic-chat', messages: [] }), /messages/);
  await assert.rejects(chat({ model_id: 'synthetic-chat', messages: [{ role: 'tool', content: 'x' }] }), /role/);
  await assert.rejects(chat({ model_id: 'synthetic-chat', messages: [{ role: 'user', content: ' ' }] }), /content/);
  await assert.rejects(chat({ model_id: 'synthetic-chat', messages, max_tokens: 0 }), /max_tokens/);
  assert.equal(called, false);
});

test('reports a timeout as one stable error without reading the body', async () => {
  const chat = createOpenAICompatibleChat({
    base_url: 'http://127.0.0.1:11434/v1',
    timeout_ms: 5,
    fetch: async () => {
      throw Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    }
  });
  await assert.rejects(chat({ model_id: 'synthetic-chat', messages }), /^Error: chat request timed out$/u);
});

test('never reads or returns a provider error body', async () => {
  let read = false;
  const chat = createOpenAICompatibleChat({
    base_url: 'http://127.0.0.1:11434/v1',
    fetch: async () => ({
      ok: false,
      status: 429,
      async json() {
        read = true;
        return { error: { message: 'quota exhausted for account 12345' } };
      }
    })
  });
  await assert.rejects(chat({ model_id: 'synthetic-chat', messages }), (error) => {
    assert.equal(error.message, 'chat request failed with status 429');
    return true;
  });
  assert.equal(read, false);
});

test('rejects a response without usable content', async () => {
  const create = (payload) => createOpenAICompatibleChat({
    base_url: 'http://127.0.0.1:11434/v1',
    fetch: respondWith(payload)
  });
  await assert.rejects(create({}).call(null, { model_id: 'synthetic-chat', messages }), /at least one choice/);
  await assert.rejects(create({ choices: [{ message: { content: 42 } }] }).call(null, { model_id: 'synthetic-chat', messages }), /message content/);
  await assert.rejects(create({ choices: [{ message: { content: '   ' } }] }).call(null, { model_id: 'synthetic-chat', messages }), /must not be empty/);
});

test('streams OpenAI-compatible content deltas across arbitrary SSE chunk boundaries', async () => {
  const calls = [];
  const payload = [
    'data: {"choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}\r\n\r\n',
    'data: {"choices":[{"delta":{"content":"The invoice "},"finish_reason":null}]}\n\n',
    'data: {"choices":[{"delta":{"content":"is on page 2 [1]."},"finish_reason":null}]}\n\n',
    'data: [DONE]\n\n'
  ].join('');
  const bytes = new TextEncoder().encode(payload);
  const chat = createOpenAICompatibleChat({
    base_url: 'http://127.0.0.1:11434/v1',
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.slice(0, 29));
          controller.enqueue(bytes.slice(29, 91));
          controller.enqueue(bytes.slice(91));
          controller.close();
        }
      }), { headers: { 'content-type': 'text/event-stream' } });
    }
  });
  const deltas = [];
  for await (const delta of chat.stream({ model_id: 'synthetic-chat', messages, max_tokens: 256 })) deltas.push(delta);
  assert.deepEqual(deltas, ['The invoice ', 'is on page 2 [1].']);
  assert.equal(calls[0].url, 'http://127.0.0.1:11434/v1/chat/completions');
  assert.equal(JSON.parse(calls[0].init.body).stream, true);
  assert.equal(calls[0].init.redirect, 'error');
});

test('cancelling a consumer cancels the upstream response reader', async () => {
  let cancelled = false;
  const chat = createOpenAICompatibleChat({
    base_url: 'http://127.0.0.1:11434/v1',
    fetch: async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"first"}}]}\n\n'));
      },
      cancel() {
        cancelled = true;
      }
    }), { headers: { 'content-type': 'text/event-stream' } })
  });
  const stream = chat.stream({ model_id: 'synthetic-chat', messages });
  assert.deepEqual(await stream.next(), { value: 'first', done: false });
  await stream.return();
  assert.equal(cancelled, true);
});

test('cancels the upstream reader after DONE if the provider leaves it open', async () => {
  let cancelled = false;
  const chat = createOpenAICompatibleChat({
    base_url: 'http://127.0.0.1:11434/v1',
    fetch: async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'));
      },
      cancel() {
        cancelled = true;
      }
    }), { headers: { 'content-type': 'text/event-stream' } })
  });
  const deltas = [];
  for await (const delta of chat.stream({ model_id: 'synthetic-chat', messages })) deltas.push(delta);
  assert.deepEqual(deltas, ['ok']);
  assert.equal(cancelled, true);
});

test('does not read an upstream provider error body for streaming requests', async () => {
  const response = new Response('provider secret', { status: 429 });
  const chat = createOpenAICompatibleChat({
    base_url: 'http://127.0.0.1:11434/v1',
    fetch: async () => response
  });
  const collect = async () => {
    for await (const _delta of chat.stream({ model_id: 'synthetic-chat', messages })) {}
  };
  await assert.rejects(collect(), /chat request failed with status 429/);
  assert.equal(response.bodyUsed, false);
});

test('rejects malformed or incomplete upstream streams without exposing provider data', async () => {
  const create = (payload, contentType = 'text/event-stream') => createOpenAICompatibleChat({
    base_url: 'http://127.0.0.1:11434/v1',
    fetch: async () => new Response(payload, { headers: { 'content-type': contentType } })
  });
  const collect = async (chat) => {
    for await (const _delta of chat.stream({ model_id: 'synthetic-chat', messages })) {}
  };
  await assert.rejects(collect(create('data: {bad-json}\n\n')), /chat response stream/);
  await assert.rejects(collect(create('data: [DONE]\n\n', 'application/json')), /text\/event-stream/);
  await assert.rejects(collect(create('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')), /chat response stream/);
  await assert.rejects(collect(create('data: {"error":{"message":"provider secret"}}\n\ndata: [DONE]\n\n')), (error) => {
    assert.equal(error.message.includes('provider secret'), false);
    return true;
  });
});
