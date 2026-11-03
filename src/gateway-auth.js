import { timingSafeEqual } from 'node:crypto';

import { GatewayError } from './gateway-error.js';
import { OPAQUE_ID_PATTERN } from './opaque-id.js';

const AUTHORIZATION_PATTERN = /^Bearer (.+)$/u;

function unauthorized() {
  // NOTE: a missing token and a wrong token share one response so a probe cannot learn which one it sent.
  return new GatewayError(401, 'unauthorized', 'Authentication is required; provide a valid bearer token and try again.');
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

function parsePrincipals(principals) {
  if (!Array.isArray(principals) || principals.length === 0) {
    throw new TypeError('principals must be a non-empty array of { token, owner_id }');
  }
  const seen = new Set();
  return principals.map((principal) => {
    if (principal === null || typeof principal !== 'object') {
      throw new TypeError('principals must be a non-empty array of { token, owner_id }');
    }
    const { token: principalToken, owner_id: principalOwner } = principal;
    if (typeof principalToken !== 'string' || principalToken.length === 0) {
      throw new TypeError('principals must be a non-empty array of { token, owner_id }');
    }
    if (typeof principalOwner !== 'string' || !OPAQUE_ID_PATTERN.test(principalOwner)) {
      throw new TypeError('principals must be a non-empty array of { token, owner_id }');
    }
    if (seen.has(principalToken)) {
      throw new TypeError('principals must not contain a duplicate token');
    }
    seen.add(principalToken);
    return Object.freeze({ token: principalToken, owner_id: principalOwner });
  });
}

export function createAuthenticator({ token, owner_id, shell_users = {}, principals } = {}) {
  const directory = principals === undefined ? undefined : parsePrincipals(principals);
  if (directory !== undefined) {
    if (Object.keys(shell_users).length > 0) {
      throw new TypeError('principals cannot be combined with shell_users');
    }
  } else if (typeof token !== 'string' || token.length === 0) {
    throw new TypeError('token must be a non-empty string');
  }
  if (directory === undefined && (typeof owner_id !== 'string' || !OPAQUE_ID_PATTERN.test(owner_id))) {
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
      if (match === null) {
        throw unauthorized();
      }
      if (directory !== undefined) {
        // The bearer token selects the principal, so a caller cannot name another identity.
        let resolved;
        for (const principal of directory) {
          // NOTE: every principal is compared so the matched position cannot leak through timing.
          if (tokenMatches(principal.token, match[1])) resolved = principal.owner_id;
        }
        if (resolved === undefined) {
          throw unauthorized();
        }
        return { owner_id: resolved };
      }
      if (!tokenMatches(token, match[1])) {
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
