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
