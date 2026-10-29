#!/usr/bin/env node

import pg from 'pg';

import { createOpenAICompatibleEmbedder, createStorage } from './index.js';
import { createAuthenticator } from './gateway-auth.js';
import { loadGatewayConfig } from './gateway-config.js';
import { createGatewayServer } from './gateway-server.js';

const config = loadGatewayConfig(process.env);
const pool = new pg.Pool({ connectionString: config.database_url });
const embed = process.env.EMBEDDING_BASE_URL === undefined
  ? undefined
  : createOpenAICompatibleEmbedder({
    base_url: process.env.EMBEDDING_BASE_URL,
    api_key: process.env.EMBEDDING_API_KEY
  });

const gateway = createGatewayServer({
  storage: createStorage({ pool }),
  authenticator: createAuthenticator({
    token: config.token,
    owner_id: config.owner_id,
    shell_users: config.shell_users
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
    await gateway.stop();
    await pool.end();
    process.exit(0);
  });
}
