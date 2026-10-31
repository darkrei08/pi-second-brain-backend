import { OPAQUE_ID_PATTERN } from './opaque-id.js';

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 8080;
export const DEFAULT_MODEL_CONCURRENCY = 4;
export const DEFAULT_MODEL_REQUESTS_PER_MINUTE = 60;
export const MINIMUM_TOKEN_LENGTH = 32;

const HOSTNAME_PATTERN = /^(?=.{1,253}\.?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.?$/u;

export function parseAllowedHosts(value, name) {
  if (value === undefined) return Object.freeze([]);
  return Object.freeze(value.split(',').map((entry) => {
    const hostname = entry.trim().toLowerCase();
    if (!HOSTNAME_PATTERN.test(hostname)) {
      throw new TypeError(`${name} contains an invalid hostname entry: ${JSON.stringify(entry.trim())}`);
    }
    return hostname;
  }).filter((hostname, index, hosts) => hosts.indexOf(hostname) === index));
}

function requireEnv(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${name} must be set`);
  }
  return value;
}

function parsePort(value) {
  if (value === undefined) return DEFAULT_PORT;
  if (!/^\d+$/u.test(value)) {
    throw new TypeError('GATEWAY_PORT must be an integer between 1 and 65535');
  }
  const port = Number(value);
  if (port < 1 || port > 65535) {
    throw new TypeError('GATEWAY_PORT must be an integer between 1 and 65535');
  }
  return port;
}

function parseModelLimit(env, name, defaultValue, maximum) {
  const value = env[name];
  if (value === undefined) return defaultValue;
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) {
    throw new TypeError(`${name} must be an integer between 1 and ${maximum}`);
  }
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximum) {
    throw new TypeError(`${name} must be an integer between 1 and ${maximum}`);
  }
  return limit;
}

function parseShellUsers(value) {
  if (value === undefined) return {};
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new TypeError('GATEWAY_SHELL_USERS must be a JSON object of shell user to owner id');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('GATEWAY_SHELL_USERS must be a JSON object of shell user to owner id');
  }
  const mapping = {};
  for (const [shell_user_id, owner_id] of Object.entries(parsed)) {
    if (!OPAQUE_ID_PATTERN.test(shell_user_id) || typeof owner_id !== 'string' || !OPAQUE_ID_PATTERN.test(owner_id)) {
      throw new TypeError('GATEWAY_SHELL_USERS must be a JSON object of shell user to owner id');
    }
    mapping[shell_user_id] = owner_id;
  }
  return mapping;
}

function parsePrincipals(value) {
  const refuse = () => new TypeError(
    'GATEWAY_PRINCIPALS must be a JSON array of { token, owner_id } with a token of at least 32 characters'
  );
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw refuse();
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw refuse();
  }
  const seen = new Set();
  return parsed.map((entry) => {
    if (entry === null || typeof entry !== 'object') throw refuse();
    const { token, owner_id } = entry;
    if (typeof token !== 'string' || token.length < MINIMUM_TOKEN_LENGTH) throw refuse();
    if (typeof owner_id !== 'string' || !OPAQUE_ID_PATTERN.test(owner_id)) throw refuse();
    if (seen.has(token)) throw refuse();
    seen.add(token);
    const principal = { owner_id };
    // The token is not enumerable, so a logged config can never carry it.
    Object.defineProperty(principal, 'token', { value: token, enumerable: false });
    return Object.freeze(principal);
  });
}

export function loadGatewayConfig(env = process.env) {
  const database_url = requireEnv(env, 'DATABASE_URL');
  const host = env.GATEWAY_HOST === undefined ? DEFAULT_HOST : requireEnv(env, 'GATEWAY_HOST');
  const port = parsePort(env.GATEWAY_PORT);
  const max_model_concurrency = parseModelLimit(env, 'GATEWAY_MODEL_CONCURRENCY', DEFAULT_MODEL_CONCURRENCY, 64);
  const model_requests_per_minute = parseModelLimit(env, 'GATEWAY_MODEL_REQUESTS_PER_MINUTE', DEFAULT_MODEL_REQUESTS_PER_MINUTE, 60000);

  if (env.GATEWAY_PRINCIPALS !== undefined) {
    // Per-principal credentials are the whole identity boundary, so a second credential source would be ambiguous.
    for (const legacy of ['GATEWAY_TOKEN', 'GATEWAY_OWNER_ID', 'GATEWAY_SHELL_USERS']) {
      if (env[legacy] !== undefined) {
        throw new TypeError(`GATEWAY_PRINCIPALS cannot be combined with ${legacy}`);
      }
    }
    return Object.freeze({
      host,
      port,
      principals: Object.freeze(parsePrincipals(env.GATEWAY_PRINCIPALS)),
      shell_users: Object.freeze({}),
      max_model_concurrency,
      model_requests_per_minute,
      database_url
    });
  }

  const token = requireEnv(env, 'GATEWAY_TOKEN');
  if (token.length < MINIMUM_TOKEN_LENGTH) {
    throw new TypeError(`GATEWAY_TOKEN must be at least ${MINIMUM_TOKEN_LENGTH} characters`);
  }
  const owner_id = requireEnv(env, 'GATEWAY_OWNER_ID');
  if (!OPAQUE_ID_PATTERN.test(owner_id)) {
    throw new TypeError('GATEWAY_OWNER_ID must be opaque');
  }
  const config = {
    host,
    port,
    owner_id,
    shell_users: parseShellUsers(env.GATEWAY_SHELL_USERS),
    max_model_concurrency,
    model_requests_per_minute,
    database_url
  };
  // The token is not enumerable, so a logged config can never carry it.
  Object.defineProperty(config, 'token', { value: token, enumerable: false });
  return Object.freeze(config);
}
