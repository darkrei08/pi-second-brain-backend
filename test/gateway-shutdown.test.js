import assert from 'node:assert/strict';
import test from 'node:test';

import { shutdownGateway } from '../src/gateway-shutdown.js';

function runShutdown({ stop, end, timeout_ms = 20 }) {
  const errors = [];
  const exits = [];
  return shutdownGateway({
    gateway: { stop },
    pool: { end },
    timeout_ms,
    writeError: (message) => errors.push(message),
    exit: (code) => exits.push(code)
  }).then(() => ({ errors, exits }));
}

test('reports a rejecting gateway stop and exits non-zero', async () => {
  const result = await runShutdown({
    stop: async () => { throw new Error('stop refused'); },
    end: async () => {}
  });
  assert.deepEqual(result.exits, [1]);
  assert.deepEqual(result.errors, ['gateway.stop failed: stop refused']);
});

test('reports a rejecting pool end and exits non-zero', async () => {
  const result = await runShutdown({
    stop: async () => {},
    end: async () => { throw new Error('pool refused'); }
  });
  assert.deepEqual(result.exits, [1]);
  assert.deepEqual(result.errors, ['pool.end failed: pool refused']);
});

test('bounds a hanging shutdown step and still closes the pool', async () => {
  let ended = false;
  const started = Date.now();
  const result = await runShutdown({
    stop: () => new Promise(() => {}),
    end: async () => { ended = true; },
    timeout_ms: 10
  });
  assert.ok(Date.now() - started < 1000);
  assert.equal(ended, true);
  assert.deepEqual(result.exits, [1]);
  assert.match(result.errors[0], /^gateway\.stop failed: timed out after 10ms$/u);
});

test('exits zero after a clean shutdown', async () => {
  const calls = [];
  const errors = [];
  const exits = [];
  await shutdownGateway({
    gateway: { stop: async () => calls.push('gateway') },
    pool: { end: async () => calls.push('pool') },
    timeout_ms: 20,
    writeError: (message) => errors.push(message),
    exit: (code) => exits.push(code)
  });
  assert.deepEqual(calls, ['gateway', 'pool']);
  assert.deepEqual(errors, []);
  assert.deepEqual(exits, [0]);
});
