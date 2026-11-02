import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ingestDirectory } from '../src/index.js';
import { createAuthenticator } from '../src/gateway-auth.js';
import { createGatewayServer } from '../src/gateway-server.js';

const token = 'a'.repeat(32);

function createStorage(overrides = {}) {
  const calls = [];
  const record = (name, result) => async (...args) => {
    calls.push({ name, args });
    if (result instanceof Error) throw result;
    return typeof result === 'function' ? result(...args) : result;
  };
  return {
    calls,
    listEmbeddingModels: record('listEmbeddingModels', []),
    saveDocumentAndSegments: record('saveDocumentAndSegments', undefined),
    listDocumentCollections: record('listDocumentCollections', ['collection-alpha']),
    ...overrides
  };
}

async function withGateway(storage, callback) {
  const gateway = createGatewayServer({
    storage,
    authenticator: createAuthenticator({ token, owner_id: 'owner-one' })
  });
  const { url } = await gateway.start();
  try {
    return await callback(url);
  } finally {
    await gateway.stop();
  }
}

async function withDirectory(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'second-brain-ingest-'));
  try {
    return await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('ingests a directory through the gateway and keeps re-upload identity stable', async () => {
  await withDirectory(async (directory) => {
    await writeFile(join(directory, 'alpha.txt'), 'Prima riga.\n\nSeconda riga.', 'utf8');
    const storage = createStorage();

    await withGateway(storage, async (gateway_url) => {
      const first = await ingestDirectory({ directory, collection_id: 'collection-alpha', gateway_url, gateway_token: token });
      const second = await ingestDirectory({ directory, collection_id: 'collection-alpha', gateway_url, gateway_token: token });

      assert.deepEqual(first, { collection_id: 'collection-alpha', documents: 1 });
      assert.deepEqual(second, { collection_id: 'collection-alpha', documents: 1 });
      const saves = storage.calls.filter(({ name }) => name === 'saveDocumentAndSegments');
      assert.equal(saves.length, 2);
      assert.equal(saves[0].args[0].document_id, saves[1].args[0].document_id);
      assert.deepEqual(saves[0].args[0].collections, ['collection-alpha']);
      assert.equal(saves[0].args[0].retention.owner_id, 'owner-one');
    });
  });
});

test('refuses the whole batch before writing when one file is invalid', async () => {
  await withDirectory(async (directory) => {
    await writeFile(join(directory, 'valid.txt'), 'valid text', 'utf8');
    await writeFile(join(directory, 'invalid.bin'), Buffer.from([0xc3, 0x28]));
    const storage = createStorage();

    await withGateway(storage, async (gateway_url) => {
      await assert.rejects(
        ingestDirectory({ directory, collection_id: 'collection-alpha', gateway_url, gateway_token: token }),
        /UTF-8/
      );
    });
    assert.deepEqual(storage.calls, []);
  });
});

test('reports an unreadable directory entry before writing', async () => {
  await withDirectory(async (directory) => {
    await mkdir(join(directory, 'not-a-file'));
    const storage = createStorage();

    await withGateway(storage, async (gateway_url) => {
      await assert.rejects(
        ingestDirectory({ directory, collection_id: 'collection-alpha', gateway_url, gateway_token: token }),
        /Cannot read file.*not-a-file/
      );
    });
    assert.deepEqual(storage.calls, []);
  });
});

test('turns a gateway refusal into a readable ingest error', async () => {
  await withDirectory(async (directory) => {
    await writeFile(join(directory, 'alpha.txt'), 'text', 'utf8');
    const storage = createStorage({
      saveDocumentAndSegments: async () => {
        throw new Error('document belongs to a different owner');
      }
    });

    await withGateway(storage, async (gateway_url) => {
      await assert.rejects(
        ingestDirectory({ directory, collection_id: 'collection-alpha', gateway_url, gateway_token: token }),
        /Gateway refused alpha\.txt: document belongs to a different owner/
      );
    });
  });
});
