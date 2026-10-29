import { timingSafeEqual } from 'node:crypto';

import { GatewayError } from './gateway-error.js';
import { OPAQUE_ID_PATTERN } from './opaque-id.js';

const AUTHORIZATION_PATTERN = /^Bearer (.+)$/u;

function unauthorized() {
  // NOTE: a missing token and a wrong token share one response so a probe cannot learn which one it sent.
  return new GatewayError(401, 'unauthorized', 'Authentication required');
}

function tokenMatches(expected, presented) {
  const expectedBytes = Buffer.from(expected, 'utf8');
  const presentedBytes = Buffer.from(presented, 'utf8');
  // NOTE: a length mismatch returns early; the length is not secret and both paths answer the same 401.
  if (expectedBytes.length !== presentedBytes.length) {
    return false;
  }
  return timingSafeEqual(expectedBytes, presentedBytes);
}

export function createAuthenticator({ token, owner_id, shell_users = {} }) {
  if (typeof token !== 'string' || token.length === 0) {
    throw new TypeError('token must be a non-empty string');
  }
  if (typeof owner_id !== 'string' || !OPAQUE_ID_PATTERN.test(owner_id)) {
    throw new TypeError('owner_id must be opaque');
  }
  // A null-prototype map plus an own-property check keeps __proto__ and friends out of the mapping.
  const mapping = Object.assign(Object.create(null), shell_users);
  const mapped = Object.keys(mapping).length > 0;

  return Object.freeze({
    owner_id,
    authenticate(headers = {}) {
      const header = headers.authorization;
      const match = typeof header === 'string' ? AUTHORIZATION_PATTERN.exec(header) : null;
      if (match === null || !tokenMatches(token, match[1])) {
        throw unauthorized();
      }
      if (!mapped) {
        return { owner_id };
      }
      const shell_user_id = headers['x-shell-user-id'];
      const resolved = typeof shell_user_id === 'string' && Object.hasOwn(mapping, shell_user_id)
        ? mapping[shell_user_id]
        : undefined;
      if (resolved === undefined) {
        throw new GatewayError(403, 'unknown_identity', 'The caller identity is not mapped');
      }
      return { owner_id: resolved };
    }
  });
}
