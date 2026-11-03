import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGatewayConfig, parseAllowedHosts, DEFAULT_HOST, DEFAULT_PORT } from '../src/gateway-config.js';

test('parses and validates approved provider hosts', () => {
  const hosts = parseAllowedHosts(' Example.COM,api.example.com., EXAMPLE.com ', 'ANSWER_ALLOWED_HOSTS');
  assert.deepEqual(hosts, ['example.com', 'api.example.com.']);
  assert.equal(Object.isFrozen(hosts), true);
  assert.deepEqual(parseAllowedHosts(undefined, 'ANSWER_ALLOWED_HOSTS'), []);
  assert.equal(Object.isFrozen(parseAllowedHosts(undefined, 'ANSWER_ALLOWED_HOSTS')), true);

  for (const [value, offending] of [
    ['', '""'],
    ['example.com,', '""'],
    ['https://example.com', 'https://example.com'],
    ['example.com:443', 'example.com:443'],
    ['example.com/path', 'example.com/path'],
    ['-bad.example', '-bad.example'],
    ['bad..example', 'bad..example']
  ]) {
    assert.throws(
      () => parseAllowedHosts(value, 'ANSWER_ALLOWED_HOSTS'),
      (error) => error instanceof TypeError && error.message.includes('ANSWER_ALLOWED_HOSTS') && error.message.includes(offending)
    );
  }
});

const baseEnv = {
  GATEWAY_TOKEN: 'a'.repeat(32),
  DATABASE_URL: 'postgres://operator@127.0.0.1:55432/rag',
  GATEWAY_OWNER_ID: 'operator-owner'
};

test('loads the documented defaults and requires the token, database, and owner', () => {
  const config = loadGatewayConfig(baseEnv);
  assert.equal(config.host, DEFAULT_HOST);
  assert.equal(config.port, DEFAULT_PORT);
  assert.equal(config.owner_id, 'operator-owner');
  assert.equal(config.max_model_concurrency, 3);
  assert.equal(config.model_requests_per_minute, 60);
  assert.deepEqual(config.shell_users, {});
  assert.equal(DEFAULT_HOST, '127.0.0.1');

  assert.throws(() => loadGatewayConfig({ ...baseEnv, GATEWAY_TOKEN: undefined }), /GATEWAY_TOKEN/);
  assert.throws(() => loadGatewayConfig({ ...baseEnv, GATEWAY_TOKEN: 'short' }), /GATEWAY_TOKEN/);
  assert.throws(() => loadGatewayConfig({ ...baseEnv, DATABASE_URL: undefined }), /DATABASE_URL/);
  assert.throws(() => loadGatewayConfig({ ...baseEnv, GATEWAY_OWNER_ID: undefined }), /GATEWAY_OWNER_ID/);
  assert.throws(() => loadGatewayConfig({ ...baseEnv, GATEWAY_OWNER_ID: '../other-owner' }), /GATEWAY_OWNER_ID/);
});

test('parses bounded model route limits and refuses invalid values by variable name', () => {
  const configured = loadGatewayConfig({
    ...baseEnv,
    GATEWAY_MODEL_CONCURRENCY: '12',
    GATEWAY_MODEL_REQUESTS_PER_MINUTE: '900'
  });
  assert.equal(configured.max_model_concurrency, 12);
  assert.equal(configured.model_requests_per_minute, 900);

  for (const value of ['', '0', '1.5', '-1', '9007199254740992', '65']) {
    assert.throws(
      () => loadGatewayConfig({ ...baseEnv, GATEWAY_MODEL_CONCURRENCY: value }),
      (error) => error instanceof TypeError && error.message.includes('GATEWAY_MODEL_CONCURRENCY')
    );
  }
  for (const value of ['', '0', '1.5', '-1', '9007199254740992', '60001']) {
    assert.throws(
      () => loadGatewayConfig({ ...baseEnv, GATEWAY_MODEL_REQUESTS_PER_MINUTE: value }),
      (error) => error instanceof TypeError && error.message.includes('GATEWAY_MODEL_REQUESTS_PER_MINUTE')
    );
  }
});

test('parses the port, the host override, and the shell-user mapping strictly', () => {
  const configured = loadGatewayConfig({
    ...baseEnv,
    GATEWAY_HOST: '127.0.0.1',
    GATEWAY_PORT: '9443',
    GATEWAY_SHELL_USERS: JSON.stringify({ 'shell-one': 'owner-one', 'shell-two': 'owner-two' })
  });
  assert.equal(configured.port, 9443);
  assert.equal(configured.host, '127.0.0.1');
  assert.deepEqual(configured.shell_users, { 'shell-one': 'owner-one', 'shell-two': 'owner-two' });

  assert.throws(() => loadGatewayConfig({ ...baseEnv, GATEWAY_PORT: '0' }), /GATEWAY_PORT/);
  assert.throws(() => loadGatewayConfig({ ...baseEnv, GATEWAY_PORT: '65536' }), /GATEWAY_PORT/);
  assert.throws(() => loadGatewayConfig({ ...baseEnv, GATEWAY_PORT: 'eighty' }), /GATEWAY_PORT/);
  assert.throws(() => loadGatewayConfig({ ...baseEnv, GATEWAY_SHELL_USERS: 'not-json' }), /GATEWAY_SHELL_USERS/);
  assert.throws(() => loadGatewayConfig({ ...baseEnv, GATEWAY_SHELL_USERS: '["shell-one"]' }), /GATEWAY_SHELL_USERS/);
  assert.throws(
    () => loadGatewayConfig({ ...baseEnv, GATEWAY_SHELL_USERS: JSON.stringify({ 'shell-one': '../other-owner' }) }),
    /GATEWAY_SHELL_USERS/
  );
  assert.throws(
    () => loadGatewayConfig({ ...baseEnv, GATEWAY_SHELL_USERS: JSON.stringify({ '../shell': 'owner-one' }) }),
    /GATEWAY_SHELL_USERS/
  );
});

test('refuses a configuration that would log or echo the token', () => {
  const config = loadGatewayConfig(baseEnv);
  assert.equal(JSON.stringify(config).includes(config.token), false);
  assert.equal(String(config).includes(config.token), false);
});

test('loads per-principal credentials instead of a shared token and a caller-selected identity', () => {
  const env = {
    DATABASE_URL: baseEnv.DATABASE_URL,
    GATEWAY_PRINCIPALS: JSON.stringify([
      { token: 'p'.repeat(32), owner_id: 'owner-one' },
      { token: 'q'.repeat(40), owner_id: 'owner-two' }
    ])
  };
  const config = loadGatewayConfig(env);
  assert.equal(config.principals.length, 2);
  assert.deepEqual(config.principals.map((principal) => principal.owner_id), ['owner-one', 'owner-two']);
  assert.equal(config.owner_id, undefined);
  assert.deepEqual(config.shell_users, {});
  for (const token of ['p'.repeat(32), 'q'.repeat(40)]) {
    assert.equal(JSON.stringify(config).includes(token), false);
    assert.equal(String(config).includes(token), false);
  }
});

test('refuses a mixed shared-token and per-principal configuration', () => {
  const principals = JSON.stringify([{ token: 'p'.repeat(32), owner_id: 'owner-one' }]);
  assert.throws(() => loadGatewayConfig({ ...baseEnv, GATEWAY_PRINCIPALS: principals }), /GATEWAY_PRINCIPALS/u);
  assert.throws(
    () => loadGatewayConfig({
      DATABASE_URL: baseEnv.DATABASE_URL,
      GATEWAY_PRINCIPALS: principals,
      GATEWAY_SHELL_USERS: JSON.stringify({ 'shell-one': 'owner-one' })
    }),
    /GATEWAY_PRINCIPALS/u
  );
});

test('refuses malformed per-principal credentials', () => {
  const load = (value) => loadGatewayConfig({ DATABASE_URL: baseEnv.DATABASE_URL, GATEWAY_PRINCIPALS: value });
  assert.throws(() => load('not-json'), /GATEWAY_PRINCIPALS/u);
  assert.throws(() => load(JSON.stringify({ token: 'p'.repeat(32), owner_id: 'owner-one' })), /GATEWAY_PRINCIPALS/u);
  assert.throws(() => load(JSON.stringify([])), /GATEWAY_PRINCIPALS/u);
  assert.throws(() => load(JSON.stringify([{ token: 'short', owner_id: 'owner-one' }])), /GATEWAY_PRINCIPALS/u);
  assert.throws(() => load(JSON.stringify([{ token: 'p'.repeat(32), owner_id: '../other-owner' }])), /GATEWAY_PRINCIPALS/u);
  assert.throws(() => load(JSON.stringify([{ token: 'p'.repeat(32) }])), /GATEWAY_PRINCIPALS/u);
  assert.throws(
    () => load(JSON.stringify([{ token: 'p'.repeat(32), owner_id: 'a' }, { token: 'p'.repeat(32), owner_id: 'b' }])),
    /GATEWAY_PRINCIPALS/u
  );
});
