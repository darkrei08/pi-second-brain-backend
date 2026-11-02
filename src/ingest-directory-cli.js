#!/usr/bin/env node

import { ingestDirectory } from './ingest-directory.js';

const [directory, collection_id, ...extra] = process.argv.slice(2);
if (!directory || !collection_id || extra.length > 0) {
  process.stderr.write('usage: ingest-directory <directory> <collection-id>\n');
  process.exit(1);
}

try {
  const result = await ingestDirectory({
    directory,
    collection_id,
    gateway_url: process.env.GATEWAY_URL,
    gateway_token: process.env.GATEWAY_TOKEN
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`ingest refused: ${error.message}\n`);
  process.exit(1);
}
