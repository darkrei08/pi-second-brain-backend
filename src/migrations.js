import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultMigrationDir = fileURLToPath(new URL('../docker/postgres/init/', import.meta.url));
const bootstrapFile = '000-migrations.sql';

export async function listMigrationFiles(dir = defaultMigrationDir) {
  return (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
}

export function selectPending(files, appliedVersions) {
  const applied = new Set(appliedVersions);
  return files.filter((file) => !applied.has(file));
}

export async function applyMigrations(client, { dir = defaultMigrationDir } = {}) {
  const files = await listMigrationFiles(dir);
  if (files.length === 0) return [];

  const table = await client.query("SELECT to_regclass('schema_migrations') AS name");
  if (!table.rows[0].name) {
    if (!files.includes(bootstrapFile)) throw new Error(`${bootstrapFile} is required to initialize schema_migrations.`);
    await client.query('BEGIN');
    try {
      await client.query(await readFile(path.join(dir, bootstrapFile), 'utf8'));
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  const result = await client.query('SELECT version FROM schema_migrations');
  // The ledger bootstrap is infrastructure; only the five schema files are tracked as migrations.
  const pending = selectPending(files.filter((file) => file !== bootstrapFile), result.rows.map(({ version }) => version));
  const applied = [];

  for (const version of pending) {
    await client.query('BEGIN');
    try {
      await client.query(await readFile(path.join(dir, version), 'utf8'));
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
      await client.query('COMMIT');
      applied.push(version);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  return applied;
}
