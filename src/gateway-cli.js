#!/usr/bin/env node

import pg from 'pg';

import { createOpenAICompatibleChat, createOpenAICompatibleEmbedder, createStorage } from './index.js';
import { createAuthenticator } from './gateway-auth.js';
import { loadGatewayConfig, parseAllowedHosts } from './gateway-config.js';
import { createGatewayServer } from './gateway-server.js';
import { shutdownGateway } from './gateway-shutdown.js';

let config;
try {
  config = loadGatewayConfig(process.env);
} catch (error) {
  process.stderr.write(`gateway configuration refused: ${error.message}\n`);
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: config.database_url });
let embed;
let chat;
let provider_hosts = {};
try {
  embed = process.env.EMBEDDING_BASE_URL === undefined
    ? undefined
    : createOpenAICompatibleEmbedder({
      base_url: process.env.EMBEDDING_BASE_URL,
      api_key: process.env.EMBEDDING_API_KEY,
      allowed_hosts: parseAllowedHosts(process.env.EMBEDDING_ALLOWED_HOSTS, 'EMBEDDING_ALLOWED_HOSTS')
    });

  chat = process.env.ANSWER_BASE_URL === undefined
    ? undefined
    : createOpenAICompatibleChat({
      base_url: process.env.ANSWER_BASE_URL,
      api_key: process.env.ANSWER_API_KEY,
      allowed_hosts: parseAllowedHosts(process.env.ANSWER_ALLOWED_HOSTS, 'ANSWER_ALLOWED_HOSTS')
    });

  provider_hosts = {
    chat: process.env.ANSWER_BASE_URL === undefined ? undefined : new URL(process.env.ANSWER_BASE_URL).host,
    embedding: process.env.EMBEDDING_BASE_URL === undefined ? undefined : new URL(process.env.EMBEDDING_BASE_URL).host
  };
} catch (error) {
  process.stderr.write(`gateway configuration refused: ${error.message}\n`);
  process.exit(1);
}

const gateway = createGatewayServer({
  storage: createStorage({ pool }),
  chat,
  answer_model: process.env.ANSWER_MODEL,
  max_model_concurrency: config.max_model_concurrency,
  model_requests_per_minute: config.model_requests_per_minute,
  audit: (event) => {
    process.stdout.write(`${JSON.stringify({ ...event, provider_host: provider_hosts[event.kind] })}\n`);
  },
  authenticator: createAuthenticator({
    token: config.token,
    owner_id: config.owner_id,
    shell_users: config.shell_users,
    principals: config.principals
  }),
  embed
});

const address = await gateway.start({ host: config.host, port: config.port });
process.stdout.write(`${JSON.stringify({ event: 'gateway_listening', ...address })}\n`);

let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    void shutdownGateway({
      gateway,
      pool,
      writeError: (message) => process.stderr.write(`gateway shutdown failed: ${message}\n`),
      exit: (code) => process.exit(code)
    });
  });
}
