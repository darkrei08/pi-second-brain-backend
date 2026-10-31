import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { applyMigrations, listMigrationFiles } from '../src/migrations.js';

export function parseDatabaseUrl(env = process.env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required to run migrations.');
  return env.DATABASE_URL;
}

async function main() {
  const connectionString = parseDatabaseUrl();
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const applied = await applyMigrations(client);
    const total = (await listMigrationFiles()).filter((file) => file !== '000-migrations.sql').length;
    for (const version of applied) console.log(JSON.stringify({ version }));
    console.log(JSON.stringify({ applied: applied.length, total }));
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
