import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { segmentDocument } from '../src/index.js';

const document = {
  document_id: 'urn:document:synthetic-001',
  text: 'Ciao, città! 😊\n\nSecondo paragrafo: l\'azione è già pronta.\n\nQuesto paragrafo è volutamente molto lungo e contiene parole sicure per il taglio finale.',
  source_label: 'synthetic-fixture.txt',
  source_hash: 'sha256:a2bd8cf34bb65b2fec0602abd4096bc25147fa08257b785ed75dc502780bc723',
  lineage: {
    parser: 'text-native@1.0.0',
    model: null
  },
  created_at: '2026-01-01T00:00:00Z',
  retention: {
    owner_id: 'synthetic-operator',
    state: 'active'
  }
};

const policy = { max_segment_chars: 48 };

 test('segments synthetic text with deterministic Unicode spans and provenance', () => {
  const result = segmentDocument(document, policy);

  assert.deepEqual(result.segments.map(({ id, document_id, segment_index, text, start_offset, end_offset, text_sha256, metadata }) => ({
    id,
    document_id,
    segment_index,
    text,
    start_offset,
    end_offset,
    text_sha256,
    metadata
  })), [
    {
      id: 'urn:segment:urn:document:synthetic-001:0',
      document_id: 'urn:document:synthetic-001',
      segment_index: 0,
      text: 'Ciao, città! 😊',
      start_offset: 0,
      end_offset: 14,
      text_sha256: '5ce300fc5579bec646ac77c2afa7d615c1dea6109b50a0d19f77507de8c83d75',
      metadata: {}
    },
    {
      id: 'urn:segment:urn:document:synthetic-001:1',
      document_id: 'urn:document:synthetic-001',
      segment_index: 1,
      text: "Secondo paragrafo: l'azione è già pronta.",
      start_offset: 16,
      end_offset: 57,
      text_sha256: '15a433cc82bdb9f16bbdcf19c6b03a4a5a760becdfac4005eea11c84a3712cb7',
      metadata: {}
    },
    {
      id: 'urn:segment:urn:document:synthetic-001:2',
      document_id: 'urn:document:synthetic-001',
      segment_index: 2,
      text: 'Questo paragrafo è volutamente molto lungo e',
      start_offset: 59,
      end_offset: 103,
      text_sha256: 'bcd804e523b7bc5c96f5ca7e650a3aebc21454f32cee312cdaaae413d58d9557',
      metadata: {}
    },
    {
      id: 'urn:segment:urn:document:synthetic-001:3',
      document_id: 'urn:document:synthetic-001',
      segment_index: 3,
      text: 'contiene parole sicure per il taglio finale.',
      start_offset: 104,
      end_offset: 148,
      text_sha256: 'ba7e16a95cfdc7ef972a932fc5cc5ca62ee392199515399b2ca1a88297db353d',
      metadata: {}
    }
  ]);

  for (const segment of result.segments) {
    assert.equal(Array.from(document.text).slice(segment.start_offset, segment.end_offset).join(''), segment.text);
    assert.deepEqual(segment.provenance, {
      segment_id: segment.id,
      sequence_index: segment.segment_index,
      source_hash: document.source_hash,
      segment_hash: `sha256:${segment.text_sha256}`,
      location: {
        page: null,
        bounding_box: null,
        char_span: [segment.start_offset, segment.end_offset]
      },
      lineage: {
        ...document.lineage,
        stage: 'chunk'
      },
      citation: {
        label: document.source_label,
        ref: `[doc:${document.document_id}#seg${segment.segment_index}]`,
        confidence: 1
      },
      retention: document.retention,
      created_at: document.created_at
    });
  }

  assert.equal(JSON.stringify(segmentDocument(document, policy)), JSON.stringify(result));
});

test('prefers sentence boundaries before safe fallback cuts', () => {
  const sentenceDocument = {
    ...document,
    document_id: 'urn:document:synthetic-sentence',
    text: 'Prima frase. Seconda frase abbastanza lunga.',
    source_hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  };

  const result = segmentDocument(sentenceDocument, { max_segment_chars: 30 });

  assert.deepEqual(result.segments.map((segment) => segment.text), [
    'Prima frase.',
    'Seconda frase abbastanza',
    'lunga.'
  ]);
});

test('preserves the specified retention states and rejects unknown states', () => {
  for (const state of ['active', 'tombstone', 'purged']) {
    assert.doesNotThrow(() => segmentDocument({ ...document, retention: { ...document.retention, state } }, policy));
  }
  assert.throws(() => segmentDocument({ ...document, retention: { owner_id: 'synthetic-operator', state: 'pending_deletion' } }, policy), /retention\.state/);
});

test('rejects invalid public inputs before producing segments', () => {
  assert.throws(() => segmentDocument({ ...document, text: '   ' }, policy), /document\.text/);
  assert.throws(() => segmentDocument({ ...document, source_hash: 'SHA256:invalid' }, policy), /source_hash/);
  assert.throws(() => segmentDocument({ ...document, document_id: '/private/source.pdf' }, policy), /document_id/);
  assert.throws(() => segmentDocument({ ...document, retention: { owner_id: 'synthetic-operator', state: 'unknown' } }, policy), /retention\.state/);
  assert.throws(() => segmentDocument(document, { max_segment_chars: 0 }), /max_segment_chars/);
});

test('CLI delegates JSON input to the public use case without extra output', () => {
  const cliPath = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const processResult = spawnSync(process.execPath, [cliPath], {
    input: JSON.stringify({ document, policy }),
    encoding: 'utf8'
  });

  assert.equal(processResult.status, 0);
  assert.equal(processResult.stderr, '');
  assert.equal(processResult.stdout, `${JSON.stringify(segmentDocument(document, policy))}\n`);
});
