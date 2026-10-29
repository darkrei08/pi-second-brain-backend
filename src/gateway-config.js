import { OPAQUE_ID_PATTERN } from './opaque-id.js';

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 8080;
export const MINIMUM_TOKEN_LENGTH = 32;

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

export function loadGatewayConfig(env = process.env) {
  const token = requireEnv(env, 'GATEWAY_TOKEN');
  if (token.length < MINIMUM_TOKEN_LENGTH) {
    throw new TypeError(`GATEWAY_TOKEN must be at least ${MINIMUM_TOKEN_LENGTH} characters`);
  }
  const database_url = requireEnv(env, 'DATABASE_URL');
  const owner_id = requireEnv(env, 'GATEWAY_OWNER_ID');
  if (!OPAQUE_ID_PATTERN.test(owner_id)) {
    throw new TypeError('GATEWAY_OWNER_ID must be opaque');
  }
  const config = {
    host: env.GATEWAY_HOST === undefined ? DEFAULT_HOST : requireEnv(env, 'GATEWAY_HOST'),
    port: parsePort(env.GATEWAY_PORT),
    owner_id,
    shell_users: parseShellUsers(env.GATEWAY_SHELL_USERS),
    database_url
  };
  // The token is not enumerable, so a logged config can never carry it.
  Object.defineProperty(config, 'token', { value: token, enumerable: false });
  return Object.freeze(config);
}
