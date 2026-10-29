import assert from 'node:assert/strict';
import test from 'node:test';

import { describeRetrievalMode } from '../src/index.js';

const modelId = 'synthetic-3d';

function hybridMatch(overrides = {}) {
  return {
    id: 'urn:segment:urn:document:a:0',
    document_id: 'urn:document:a',
    segment_index: 0,
    hybrid_score: 0.03,
    lexical_rank: 1,
    semantic_rank: 1,
    ...overrides
  };
}

test('rejects malformed input before reading any match', () => {
  assert.throws(() => describeRetrievalMode('nope'), /matches must be an array/);
  assert.throws(() => describeRetrievalMode([null]), /matches\[0\] must be an object/);
  assert.throws(() => describeRetrievalMode([hybridMatch()], { model_id: '/private/model' }), /model_id must be opaque/);
});

test('reports a hybrid mode when any match came from the semantic side', () => {
  const matches = [
    hybridMatch({ lexical_rank: 1, semantic_rank: 1 }),
    hybridMatch({ segment_index: 1, lexical_rank: 2, semantic_rank: null }),
    hybridMatch({ segment_index: 2, lexical_rank: null, semantic_rank: 2 })
  ];

  assert.deepEqual(describeRetrievalMode(matches, { model_id: modelId }), {
    mode: 'hybrid',
    model_id: modelId,
    matches: 3,
    semantic_matches: 2
  });
});

test('reports a lexical mode when no match carries semantic evidence', () => {
  const matches = [
    hybridMatch({ lexical_rank: 1, semantic_rank: null }),
    hybridMatch({ segment_index: 1, lexical_rank: 2, semantic_rank: null })
  ];

  assert.deepEqual(describeRetrievalMode(matches, { model_id: modelId }), {
    mode: 'lexical',
    model_id: modelId,
    matches: 2,
    semantic_matches: 0
  });
});

test('echoes an absent model_id as null', () => {
  const matches = [{ id: 'urn:segment:urn:document:a:0', document_id: 'urn:document:a', segment_index: 0, rank: 0.5 }];

  assert.deepEqual(describeRetrievalMode(matches), {
    mode: 'lexical',
    model_id: null,
    matches: 1,
    semantic_matches: 0
  });
});

test('reports an empty result without throwing', () => {
  assert.deepEqual(describeRetrievalMode([], { model_id: modelId }), {
    mode: 'empty',
    model_id: modelId,
    matches: 0,
    semantic_matches: 0
  });
});

test('fails closed on a present but invalid semantic rank', () => {
  assert.throws(
    () => describeRetrievalMode([hybridMatch({ semantic_rank: 0 })], { model_id: modelId }),
    /semantic_rank must be a positive integer/
  );
  assert.throws(
    () => describeRetrievalMode([hybridMatch({ semantic_rank: 1.5 })], { model_id: modelId }),
    /semantic_rank must be a positive integer/
  );
});

test('never reorders or mutates the matches', () => {
  const matches = [
    hybridMatch({ segment_index: 2, semantic_rank: null }),
    hybridMatch({ segment_index: 0, semantic_rank: 1 })
  ];
  const snapshot = structuredClone(matches);

  describeRetrievalMode(matches, { model_id: modelId });

  assert.deepEqual(matches, snapshot);
  assert.equal(matches[0].segment_index, 2);
});
