import { createHash } from 'node:crypto';

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const DOCUMENT_ID_PATTERN = /^urn:document:[A-Za-z0-9][A-Za-z0-9._~-]*$/;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]*$/;
const RETENTION_STATES = new Set(['active', 'pending_deletion', 'deleted']);
const SENTENCE_ENDINGS = new Set(['.', '!', '?', '。', '！', '？']);
const PUNCTUATION_BOUNDARIES = new Set([',', ';', ':', ')', ']', '}', '、', '。', '，', '；', '：']);

function fail(message) {
  throw new TypeError(message);
}

function requireObject(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${name} must be an object`);
  }
}

function requireText(value, name) {
  if (typeof value !== 'string' || value.length === 0 || value.trim().length === 0) {
    fail(`${name} must be non-empty text`);
  }
}

function requireHash(value, name) {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    fail(`${name} must be a lowercase SHA-256 hash`);
  }
}

function requireOpaqueId(value, name) {
  if (typeof value !== 'string' || !OPAQUE_ID_PATTERN.test(value)) {
    fail(`${name} must be opaque`);
  }
}

function validateDocument(document) {
  requireObject(document, 'document');
  if (typeof document.document_id !== 'string' || !DOCUMENT_ID_PATTERN.test(document.document_id)) {
    fail('document.document_id must be an opaque document URN');
  }
  requireText(document.text, 'document.text');
  requireText(document.source_label, 'document.source_label');
  if (/[/\\\u0000-\u001f\u007f]/u.test(document.source_label) || document.source_label !== document.source_label.trim() || document.source_label.includes('..')) {
    fail('document.source_label must be sanitized');
  }
  requireHash(document.source_hash, 'document.source_hash');
  requireObject(document.lineage, 'document.lineage');
  requireText(document.lineage.parser, 'document.lineage.parser');
  if (document.lineage.model !== null && typeof document.lineage.model !== 'string') {
    fail('document.lineage.model must be text or null');
  }
  requireText(document.lineage.stage, 'document.lineage.stage');
  if (typeof document.created_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(document.created_at) || Number.isNaN(Date.parse(document.created_at))) {
    fail('document.created_at must be RFC3339');
  }
  requireObject(document.retention, 'document.retention');
  requireOpaqueId(document.retention.owner_id, 'document.retention.owner_id');
  if (!RETENTION_STATES.has(document.retention.state)) {
    fail('document.retention.state is invalid');
  }
}

function validatePolicy(policy) {
  requireObject(policy, 'policy');
  if (!Number.isInteger(policy.max_segment_chars) || policy.max_segment_chars <= 0) {
    fail('policy.max_segment_chars must be a positive integer');
  }
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function trimStart(codePoints, start, end) {
  while (start < end && /\s/u.test(codePoints[start])) start += 1;
  return start;
}

function trimEnd(codePoints, start, end) {
  while (end > start && /\s/u.test(codePoints[end - 1])) end -= 1;
  return end;
}

function paragraphRanges(text, codePoints) {
  const ranges = [];
  const paragraphBreak = /(?:\r?\n){2,}|\r?\n[ \t]+\r?\n/gu;
  let utf16Start = 0;
  let match;
  while ((match = paragraphBreak.exec(text)) !== null) {
    const start = Array.from(text.slice(0, utf16Start)).length;
    const end = Array.from(text.slice(0, match.index)).length;
    ranges.push([start, end]);
    utf16Start = match.index + match[0].length;
  }
  ranges.push([Array.from(text.slice(0, utf16Start)).length, codePoints.length]);
  return ranges;
}

function chooseCut(codePoints, start, limit) {
  let sentenceCut = 0;
  let punctuationCut = 0;
  let whitespaceCut = 0;
  for (let index = start + 1; index <= limit; index += 1) {
    const character = codePoints[index - 1];
    if (/\s/u.test(character)) whitespaceCut = index - 1;
    if (SENTENCE_ENDINGS.has(character)) sentenceCut = index;
    if (PUNCTUATION_BOUNDARIES.has(character)) punctuationCut = index;
  }
  return sentenceCut || whitespaceCut || punctuationCut || limit;
}

function splitRange(codePoints, rangeStart, rangeEnd, maxChars) {
  const chunks = [];
  let start = trimStart(codePoints, rangeStart, rangeEnd);
  const end = trimEnd(codePoints, start, rangeEnd);
  while (start < end) {
    const limit = Math.min(start + maxChars, end);
    let cut = limit === end ? end : chooseCut(codePoints, start, limit);
    cut = trimEnd(codePoints, start, cut);
    if (cut <= start) cut = limit;
    const chunkEnd = trimEnd(codePoints, start, cut);
    chunks.push([start, chunkEnd]);
    start = trimStart(codePoints, cut, end);
  }
  return chunks;
}

export function segmentDocument(document, policy) {
  validateDocument(document);
  validatePolicy(policy);

  const codePoints = Array.from(document.text);
  const ranges = paragraphRanges(document.text, codePoints).flatMap(([start, end]) => splitRange(codePoints, start, end, policy.max_segment_chars));
  const segments = ranges.map(([start_offset, end_offset], segment_index) => {
    const text = codePoints.slice(start_offset, end_offset).join('');
    const text_sha256 = sha256(text);
    const id = `urn:segment:${document.document_id}:${segment_index}`;
    return {
      id,
      document_id: document.document_id,
      segment_index,
      text,
      start_offset,
      end_offset,
      text_sha256,
      metadata: {},
      provenance: {
        segment_id: id,
        sequence_index: segment_index,
        source_hash: document.source_hash,
        segment_hash: `sha256:${text_sha256}`,
        location: {
          page: null,
          bounding_box: null,
          char_span: [start_offset, end_offset]
        },
        lineage: {
          parser: document.lineage.parser,
          model: document.lineage.model,
          stage: document.lineage.stage
        },
        citation: {
          label: document.source_label,
          ref: `[doc:${document.document_id}#seg${segment_index}]`,
          confidence: 1
        },
        retention: {
          owner_id: document.retention.owner_id,
          state: document.retention.state
        },
        created_at: document.created_at
      }
    };
  });

  return {
    document_id: document.document_id,
    source_hash: document.source_hash,
    segments
  };
}
