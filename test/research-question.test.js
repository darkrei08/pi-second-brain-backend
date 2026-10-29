import assert from 'node:assert/strict';
import test from 'node:test';

import { researchQuestion, INSUFFICIENT_EVIDENCE_ANSWER } from '../src/answer-question.js';
import { segmentDocument } from '../src/index.js';

const owner_id = 'research-owner';

function match(index) {
  const document = {
    document_id: `urn:document:research-${index}`,
    text: `Evidence segment ${index} about the requested topic.`,
    source_label: `research-${index}.txt`,
    source_hash: `sha256:${String(index).padStart(2, '0').repeat(32)}`,
    lineage: { parser: 'synthetic@1', model: null },
    created_at: '2026-01-06T00:00:00Z',
    retention: { owner_id, state: 'active' }
  };
  const segmented = segmentDocument(document, { max_segment_chars: 1000 });
  return {
    ...segmented.segments[0],
    source_hash: document.source_hash,
    source_label: document.source_label,
    owner_id,
    retention_state: 'active',
    rank: 0.5
  };
}

function createStorage(results, stale_ids = []) {
  const calls = [];
  return {
    calls,
    async searchSegmentsLexical(input) {
      calls.push({ name: 'searchSegmentsLexical', input });
      return results.get(input.query) ?? [];
    },
    async searchSegmentsHybrid(input) {
      calls.push({ name: 'searchSegmentsHybrid', input });
      return results.get(input.query) ?? [];
    },
    async getEmbeddingModel(model_id) {
      calls.push({ name: 'getEmbeddingModel', input: { model_id } });
      return { model_id, dimensions: 3, status: 'active' };
    },
    async revalidateCitations(citations, options) {
      calls.push({ name: 'revalidateCitations', input: { citations, options } });
      return { valid: stale_ids.length === 0, stale_ids };
    }
  };
}

test('plans up to two follow-ups, deduplicates evidence, and synthesizes once over the capped evidence', async () => {
  const first = match(1);
  const second = match(2);
  const third = match(3);
  const fourth = match(4);
  const storage = createStorage(new Map([
    ['main question', [first, second]],
    ['follow-up alpha', [second, third]],
    ['follow-up beta', [third, fourth]]
  ]), [third.id]);
  const chatCalls = [];
  const result = await researchQuestion({
    storage,
    chat: async (input) => {
      chatCalls.push(input);
      return input.max_tokens === 128
        ? JSON.stringify({ queries: ['follow-up alpha', 'follow-up beta'] })
        : 'Evidence supports [1] and [3], with an ungrounded claim [9].';
    },
    question: 'main question',
    owner_id,
    collection_ids: ['scope-alpha'],
    model_id: 'synthetic-chat',
    limit: 6,
    max_tokens: 500
  });

  const searches = storage.calls.filter(({ name }) => name === 'searchSegmentsLexical');
  assert.deepEqual(searches.map(({ input }) => input.query), ['main question', 'follow-up alpha', 'follow-up beta']);
  assert.deepEqual(searches.map(({ input }) => input.limit), [2, 2, 2]);
  assert.ok(searches.every(({ input }) => input.owner_id === owner_id));
  assert.ok(searches.every(({ input }) => input.collection_ids[0] === 'scope-alpha'));
  assert.equal(chatCalls.length, 2, 'one planner call and one final synthesis');
  assert.equal(chatCalls[0].max_tokens, 128);
  assert.match(chatCalls[0].messages[0].content, /untrusted data/u);
  assert.equal(chatCalls[1].max_tokens, 500);
  const evidence = chatCalls[1].messages[1].content.split('\n')
    .filter((line) => line.startsWith('{"index":'))
    .map((line) => JSON.parse(line));
  assert.deepEqual(evidence.map(({ segment_id }) => segment_id), [first.id, second.id, third.id, fourth.id]);
  assert.equal(result.retrieval.matches, 4);
  assert.equal(result.citations.length, 2);
  assert.deepEqual(result.unresolved_citations, [9]);
  assert.deepEqual(result.stale_citations, [third.id]);
  assert.equal(result.uncertainty.level, 'high');
  assert.equal(result.uncertainty.evidence_count, 4);
  const revalidation = storage.calls.find(({ name }) => name === 'revalidateCitations');
  assert.deepEqual(revalidation.input.options, { owner_id });
});

test('short-circuits empty evidence and safely ends expansion for malformed planner output', async () => {
  const emptyStorage = createStorage(new Map());
  let emptyModelCalls = 0;
  const empty = await researchQuestion({
    storage: emptyStorage,
    chat: async () => { emptyModelCalls += 1; return 'must not run'; },
    question: 'no matching evidence',
    owner_id,
    model_id: 'synthetic-chat'
  });
  assert.equal(empty.answer, INSUFFICIENT_EVIDENCE_ANSWER);
  assert.equal(empty.uncertainty.level, 'unsupported');
  assert.equal(emptyModelCalls, 0);

  const only = match(1);
  const storage = createStorage(new Map([['question', [only]]]));
  const chatCalls = [];
  const result = await researchQuestion({
    storage,
    chat: async (input) => {
      chatCalls.push(input);
      return input.max_tokens === 128 ? 'not JSON' : 'Supported answer [1].';
    },
    question: 'question',
    owner_id,
    model_id: 'synthetic-chat'
  });
  assert.equal(storage.calls.filter(({ name }) => name.startsWith('searchSegments')).length, 1);
  assert.equal(chatCalls.length, 2, 'malformed plan falls back to one final synthesis');
  assert.equal(result.answer, 'Supported answer [1].');
  assert.equal(result.citations.length, 1);
});

test('deduplicates valid repeated follow-up queries by case and whitespace', async () => {
  const only = match(1);
  const next = match(2);
  const storage = createStorage(new Map([
    ['question', [only]],
    ['follow-up', [next]]
  ]));
  const chatCalls = [];
  await researchQuestion({
    storage,
    chat: async (input) => {
      chatCalls.push(input);
      return input.max_tokens === 128
        ? JSON.stringify({ queries: [' Follow-Up ', 'follow-up'] })
        : 'Supported answer [1].';
    },
    question: 'question',
    owner_id,
    model_id: 'synthetic-chat',
    limit: 6
  });
  const searches = storage.calls.filter(({ name }) => name.startsWith('searchSegments'));
  assert.deepEqual(searches.map(({ input }) => input.query), ['question', 'Follow-Up']);
  await assert.rejects(researchQuestion({ storage, chat: async () => 'x', question: ' ', owner_id, model_id: 'chat' }), /question/);
  await assert.rejects(researchQuestion({ storage, chat: async () => 'x', question: 'q', owner_id, model_id: 'chat', limit: 101 }), /limit/);
});

test('fails closed for planner JSON with too many or invalid follow-up queries', async () => {
  const invalidPlans = [
    { queries: ['follow-up', 'second', 'third'] },
    { queries: ['follow-up', 9] },
    { queries: ['follow-up', 'x'.repeat(257)] },
    { queries: ['follow-up', '\tsecond'] }
  ];
  for (const plan of invalidPlans) {
    const first = match(1);
    const second = match(2);
    const storage = createStorage(new Map([
      ['question', [first]],
      ['follow-up', [second]],
      ['second', [match(3)]]
    ]));
    let plannerCalls = 0;
    await researchQuestion({
      storage,
      chat: async (input) => {
        if (input.max_tokens === 128) {
          plannerCalls += 1;
          return JSON.stringify(plan);
        }
        return 'Grounded answer [1].';
      },
      question: 'question',
      owner_id,
      model_id: 'synthetic-chat',
      limit: 6
    });
    assert.equal(plannerCalls, 1);
    assert.deepEqual(
      storage.calls.filter(({ name }) => name.startsWith('searchSegments')).map(({ input }) => input.query),
      ['question']
    );
  }
});

test('stops expansion when a follow-up adds no new evidence', async () => {
  const first = match(1);
  const storage = createStorage(new Map([
    ['question', [first]],
    ['follow-up', [first]],
    ['second-follow-up', [match(2)]]
  ]));
  const chatCalls = [];
  const result = await researchQuestion({
    storage,
    chat: async (input) => {
      chatCalls.push(input);
      return input.max_tokens === 128
        ? JSON.stringify({ queries: ['follow-up', 'second-follow-up'] })
        : 'Grounded answer [1].';
    },
    question: 'question',
    owner_id,
    model_id: 'synthetic-chat',
    limit: 6
  });
  assert.deepEqual(
    storage.calls.filter(({ name }) => name.startsWith('searchSegments')).map(({ input }) => input.query),
    ['question', 'follow-up']
  );
  assert.equal(chatCalls.length, 2, 'one planner call and one final synthesis');
  assert.equal(result.retrieval.matches, 1);
});

test('caps unique evidence across all retrieval rounds at the requested limit', async () => {
  const first = match(1);
  const second = match(2);
  const third = match(3);
  const storage = createStorage(new Map([
    ['question', [first]],
    ['follow-up', [first, second]],
    ['second-follow-up', [third]]
  ]));
  const chatCalls = [];
  const result = await researchQuestion({
    storage,
    chat: async (input) => {
      chatCalls.push(input);
      return input.max_tokens === 128
        ? JSON.stringify({ queries: ['follow-up', 'second-follow-up'] })
        : 'Grounded answer [1].';
    },
    question: 'question',
    owner_id,
    model_id: 'synthetic-chat',
    limit: 2
  });
  const searches = storage.calls.filter(({ name }) => name.startsWith('searchSegments'));
  assert.deepEqual(searches.map(({ input }) => input.query), ['question', 'follow-up']);
  assert.deepEqual(searches.map(({ input }) => input.limit), [1, 1]);
  assert.equal(result.retrieval.matches, 2);
  assert.equal(chatCalls.length, 2, 'one planner call and one final synthesis');
});
