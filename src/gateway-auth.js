import { createHmac, timingSafeEqual } from 'node:crypto';

import { GatewayError } from './gateway-error.js';
import { OPAQUE_ID_PATTERN, OWNER_ID_PATTERN } from './opaque-id.js';

const AUTHORIZATION_PATTERN = /^Bearer (.+)$/u;
const CLAIM_SIGNATURE_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_CLAIM_FUTURE_SECONDS = 120;

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

function invalidClaim(message) {
  return new GatewayError(403, 'invalid_claim', message);
}

function claimOwner(headers, secret, now) {
  const user_id = headers['x-shell-user-id'];
  const group_id = headers['x-shell-group-id'];
  const expiry = headers['x-shell-claim-expiry'];
  const signature = headers['x-shell-claim-signature'];
  const claimPresent = [group_id, expiry, signature].some((value) => value !== undefined);
  if (!claimPresent) return null;
  if (typeof secret !== 'string' || secret.length === 0) {
    throw invalidClaim('Signed shell claims are not configured; ask the operator to configure the gateway claim secret and try again.');
  }
  if (typeof user_id !== 'string' || !OPAQUE_ID_PATTERN.test(user_id)
    || (group_id !== undefined && (typeof group_id !== 'string' || (group_id !== '' && !OPAQUE_ID_PATTERN.test(group_id))))
    || typeof expiry !== 'string' || !/^\d+$/u.test(expiry) || !Number.isSafeInteger(Number(expiry))
    || typeof signature !== 'string' || !CLAIM_SIGNATURE_PATTERN.test(signature)) {
    throw invalidClaim('The shell claim is incomplete or malformed; request a fresh signed claim from the shell and try again.');
  }
  const normalizedGroup = group_id ?? '';
  const expected = createHmac('sha256', secret).update(`${user_id}\n${normalizedGroup}\n${expiry}`).digest();
  const presented = Buffer.from(signature, 'hex');
  if (presented.length !== expected.length || !timingSafeEqual(expected, presented)) {
    throw invalidClaim('The shell claim signature is invalid; request a fresh signed claim from the shell and try again.');
  }
  const expirySeconds = Number(expiry);
  if (expirySeconds < now) {
    throw invalidClaim('The shell claim has expired; request a fresh signed claim from the shell and try again.');
  }
  if (expirySeconds > now + MAX_CLAIM_FUTURE_SECONDS) {
    throw invalidClaim('The shell claim expiry is too far in the future; check the shell clock and try again.');
  }
  return normalizedGroup === '' ? `urn:user:${user_id}` : `urn:group:${normalizedGroup}`;
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
    if (typeof principalOwner !== 'string' || !OWNER_ID_PATTERN.test(principalOwner)) {
      throw new TypeError('principals must be a non-empty array of { token, owner_id }');
    }
    if (seen.has(principalToken)) {
      throw new TypeError('principals must not contain a duplicate token');
    }
    seen.add(principalToken);
    return Object.freeze({ token: principalToken, owner_id: principalOwner });
  });
}

export function createAuthenticator({ token, owner_id, shell_users = {}, principals, shell_claim_secret, now = () => Math.floor(Date.now() / 1000) } = {}) {
  const directory = principals === undefined ? undefined : parsePrincipals(principals);
  if (directory !== undefined) {
    if (Object.keys(shell_users).length > 0) {
      throw new TypeError('principals cannot be combined with shell_users');
    }
  } else if (typeof token !== 'string' || token.length === 0) {
    throw new TypeError('token must be a non-empty string');
  }
  if (directory === undefined && (typeof owner_id !== 'string' || !OWNER_ID_PATTERN.test(owner_id))) {
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
        const claimedOwner = claimOwner(headers, shell_claim_secret, now());
        return { owner_id: claimedOwner ?? resolved };
      }
      if (!tokenMatches(token, match[1])) {
        throw unauthorized();
      }
      const claimedOwner = claimOwner(headers, shell_claim_secret, now());
      if (claimedOwner !== null) {
        return { owner_id: claimedOwner };
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
