import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCitations, segmentDocument } from '../src/index.js';

const document = {
  document_id: 'urn:document:citation-synthetic',
  text: 'Invoice evidence with a stable citation.',
  source_label: 'synthetic-citation.txt',
  source_hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  lineage: { parser: 'synthetic-parser@1.0.0', model: null },
  created_at: '2026-01-01T00:00:00Z',
  retention: { owner_id: 'citation-owner-a', state: 'active' }
};
const segmented = segmentDocument(document, { max_segment_chars: 100 });
const validResult = {
  ...segmented.segments[0],
  source_hash: document.source_hash,
  source_label: document.source_label,
  owner_id: document.retention.owner_id,
  retention_state: 'active'
};

function cloneResult(overrides = {}) {
  return {
    ...validResult,
    ...overrides,
    provenance: {
      ...validResult.provenance,
      ...(overrides.provenance || {})
    }
  };
}

test('maps valid retrieved segments to prompt-ready evidence', () => {
  const [evidence] = resolveCitations([validResult], { owner_id: document.retention.owner_id });

  assert.deepEqual(evidence, {
    document_id: validResult.document_id,
    segment_id: validResult.id,
    text: validResult.text,
    citation: {
      label: validResult.provenance.citation.label,
      ref: validResult.provenance.citation.ref,
      confidence: validResult.provenance.citation.confidence,
      source_hash: validResult.source_hash,
      segment_hash: validResult.provenance.segment_hash,
      location: validResult.provenance.location,
      lineage: validResult.provenance.lineage
    }
  });
});

test('preserves normalized page and bounding-box metadata', () => {
  const location = {
    ...validResult.provenance.location,
    page: 2,
    bounding_box: [0.1, 0.2, 0.8, 0.9]
  };
  const [evidence] = resolveCitations([cloneResult({ provenance: { location } })], { owner_id: document.retention.owner_id });

  assert.deepEqual(evidence.citation.location, location);
});

test('rejects invalid ownership, retention, hashes, citation, location, confidence, and batches', async () => {
  await assert.rejects(
    async () => resolveCitations([validResult], { owner_id: 'citation-owner-b' }),
    /owner_id/
  );
  await assert.rejects(
    async () => resolveCitations([cloneResult({ retention_state: 'tombstone' })], { owner_id: document.retention.owner_id }),
    /active/
  );
  await assert.rejects(
    async () => resolveCitations([cloneResult({ retention_state: 'purged' })], { owner_id: document.retention.owner_id }),
    /active/
  );
  await assert.rejects(
    async () => resolveCitations([cloneResult({ provenance: { retention: { ...validResult.provenance.retention, owner_id: 'citation-owner-b' } } })], { owner_id: document.retention.owner_id }),
    /retention/
  );
  await assert.rejects(
    async () => resolveCitations([cloneResult({ text_sha256: 'b'.repeat(64) })], { owner_id: document.retention.owner_id }),
    /text_sha256/
  );
  await assert.rejects(
    async () => resolveCitations([cloneResult({ provenance: { source_hash: 'sha256:' + 'b'.repeat(64) } })], { owner_id: document.retention.owner_id }),
    /source_hash/
  );
  await assert.rejects(
    async () => resolveCitations([cloneResult({ provenance: { citation: { ...validResult.provenance.citation, ref: '[invalid]' } } })], { owner_id: document.retention.owner_id }),
    /citation ref/
  );
  await assert.rejects(
    async () => resolveCitations([cloneResult({ provenance: { location: { ...validResult.provenance.location, char_span: [1, 2] } } })], { owner_id: document.retention.owner_id }),
    /char_span/
  );
  await assert.rejects(
    async () => resolveCitations([cloneResult({ provenance: { lineage: { ...validResult.provenance.lineage, parser: '' } } })], { owner_id: document.retention.owner_id }),
    /parser/
  );
  await assert.rejects(
    async () => resolveCitations([cloneResult({ provenance: { citation: { ...validResult.provenance.citation, label: '../private.pdf' } } })], { owner_id: document.retention.owner_id }),
    /label/
  );
  await assert.rejects(
    async () => resolveCitations([cloneResult({ provenance: { citation: { ...validResult.provenance.citation, confidence: 0.2 } } })], { owner_id: document.retention.owner_id, min_confidence: 0.5 }),
    /confidence/
  );
  await assert.rejects(
    async () => resolveCitations([validResult, cloneResult({ text_sha256: 'c'.repeat(64) })], { owner_id: document.retention.owner_id }),
    /text_sha256/
  );
});

test('rejects malformed resolver options and result collections', async () => {
  await assert.rejects(async () => resolveCitations([], { owner_id: document.retention.owner_id }), /non-empty/);
  await assert.rejects(async () => resolveCitations([validResult], { owner_id: '../other-owner' }), /owner_id/);
  await assert.rejects(async () => resolveCitations([validResult], { owner_id: document.retention.owner_id, min_confidence: 2 }), /min_confidence/);
  await assert.rejects(async () => resolveCitations([null], { owner_id: document.retention.owner_id }), /result/);
});
