import assert from 'node:assert/strict';
import test from 'node:test';

import { createAuthenticator } from '../src/gateway-auth.js';

const token = 'a'.repeat(32);
const singleOwner = createAuthenticator({ token, owner_id: 'operator-owner', shell_users: {} });
const mapped = createAuthenticator({
  token,
  owner_id: 'operator-owner',
  shell_users: { 'shell-one': 'owner-one', 'shell-two': 'owner-two' }
});

test('rejects a missing, malformed, or wrong token with one indistinguishable failure', () => {
  const failures = [
    {},
    { authorization: 'Bearer ' },
    { authorization: token },
    { authorization: `Basic ${token}` },
    { authorization: `Bearer ${'b'.repeat(32)}` },
    { authorization: `Bearer ${'b'.repeat(64)}` },
    { authorization: `bearer ${token}` }
  ];
  const seen = new Set();
  for (const headers of failures) {
    assert.throws(
      () => singleOwner.authenticate(headers),
      (error) => {
        assert.equal(error.status, 401);
        assert.equal(error.code, 'unauthorized');
        seen.add(`${error.status}:${error.code}:${error.message}`);
        return true;
      }
    );
  }
  assert.equal(seen.size, 1);
});

test('derives the configured owner without a shell-user mapping', () => {
  assert.deepEqual(singleOwner.authenticate({ authorization: `Bearer ${token}` }), { owner_id: 'operator-owner' });
  assert.deepEqual(
    singleOwner.authenticate({ authorization: `Bearer ${token}`, 'x-shell-user-id': 'any-shell-user' }),
    { owner_id: 'operator-owner' }
  );
});

test('resolves a mapped shell user and fails closed on an unknown or missing one', () => {
  assert.deepEqual(
    mapped.authenticate({ authorization: `Bearer ${token}`, 'x-shell-user-id': 'shell-two' }),
    { owner_id: 'owner-two' }
  );
  for (const headers of [
    { authorization: `Bearer ${token}` },
    { authorization: `Bearer ${token}`, 'x-shell-user-id': 'shell-unknown' },
    { authorization: `Bearer ${token}`, 'x-shell-user-id': '' },
    { authorization: `Bearer ${token}`, 'x-shell-user-id': '__proto__' },
    { authorization: `Bearer ${token}`, 'x-shell-user-id': 'constructor' },
    { authorization: `Bearer ${token}`, 'x-shell-user-id': 'toString' }
  ]) {
    assert.throws(
      () => mapped.authenticate(headers),
      (error) => {
        assert.equal(error.status, 403);
        assert.equal(error.code, 'unknown_identity');
        return true;
      }
    );
  }
});

test('never accepts an owner hinted by the caller', () => {
  const result = mapped.authenticate({
    authorization: `Bearer ${token}`,
    'x-shell-user-id': 'shell-one',
    'x-owner-id': 'owner-two'
  });
  assert.deepEqual(result, { owner_id: 'owner-one' });
});
