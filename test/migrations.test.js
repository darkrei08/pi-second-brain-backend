import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseDatabaseUrl } from '../scripts/migrate.mjs';
import { listMigrationFiles, selectPending } from '../src/migrations.js';

test('lists SQL migration filenames in lexicographic order', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'migrations-'));
  try {
    await Promise.all(['002-schema.sql', '001-extensions.sql', 'notes.txt'].map((name) => writeFile(path.join(dir, name), '')));
    assert.deepEqual(await listMigrationFiles(dir), ['001-extensions.sql', '002-schema.sql']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('selects only unapplied migration files and preserves order', () => {
  assert.deepEqual(
    selectPending(['001.sql', '002.sql', '003.sql'], ['002.sql']),
    ['001.sql', '003.sql']
  );
});

test('returns an empty list for an empty migration directory', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'migrations-'));
  try {
    assert.deepEqual(await listMigrationFiles(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('refuses to plan without DATABASE_URL', () => {
  assert.throws(() => parseDatabaseUrl({}), { message: 'DATABASE_URL is required to run migrations.' });
});
