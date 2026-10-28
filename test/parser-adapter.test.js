import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeParserOutput, segmentDocument } from '../src/index.js';

const envelope = {
  document_id: 'urn:document:parser-synthetic',
  source_label: 'synthetic-parser-fixture.pdf',
  source_hash: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  lineage: { parser: 'synthetic-parser@1.0.0', model: 'synthetic-model@1.0.0' },
  created_at: '2026-01-01T00:00:00Z',
  retention: { owner_id: 'synthetic-owner', state: 'active' }
};

function assertNormalized(result, text, element) {
  assert.equal(result.text, text);
  assert.deepEqual(result.elements, [element]);
  assert.deepEqual(Array.from(result.text).slice(element.start_offset, element.end_offset).join(''), element.text);
  assert.deepEqual({ ...result, text: undefined, elements: undefined }, { ...envelope, text: undefined, elements: undefined });
}

test('normalizes synthetic Docling bottom-left geometry and Unicode spans', () => {
  const result = normalizeParserOutput({
    parser_type: 'docling',
    envelope,
    raw_json: {
      pages: [{ page_no: 1, width: 200, height: 100 }],
      texts: [{
        text: 'Città 😊',
        prov: [{ page_no: 1, bbox: [20, 20, 120, 60], coord_origin: 'BOTTOMLEFT' }]
      }]
    }
  });

  assertNormalized(result, 'Città 😊', {
    text: 'Città 😊',
    start_offset: 0,
    end_offset: 7,
    page: 1,
    bounding_box: [0.1, 0.4, 0.6, 0.8]
  });
});

test('normalizes synthetic MinerU zero-based pages and thousand-scale boxes', () => {
  const result = normalizeParserOutput({
    parser_type: 'mineru',
    envelope,
    raw_json: {
      pages: [{ page_idx: 0, width: 1000, height: 1400 }],
      content_list: [{ text: 'Prima pagina', page_idx: 0, bbox: [100, 200, 800, 600] }]
    }
  });

  assertNormalized(result, 'Prima pagina', {
    text: 'Prima pagina',
    start_offset: 0,
    end_offset: 12,
    page: 1,
    bounding_box: [0.1, 0.2, 0.8, 0.6]
  });
});

test('normalizes synthetic PaddleOCR pixel boxes and ordered blocks', () => {
  const result = normalizeParserOutput({
    parser_type: 'paddleocr',
    envelope,
    raw_json: {
      pages: [{ page: 1, width: 800, height: 600 }],
      blocks: [
        { text: 'Uno', page: 1, bbox: [80, 60, 400, 180] },
        { text: 'Due 😊', page: 1, bbox: [400, 300, 720, 540] }
      ]
    }
  });

  assert.equal(result.text, 'Uno\n\nDue 😊');
  assert.deepEqual(result.elements, [
    { text: 'Uno', start_offset: 0, end_offset: 3, page: 1, bounding_box: [0.1, 0.1, 0.5, 0.3] },
    { text: 'Due 😊', start_offset: 5, end_offset: 10, page: 1, bounding_box: [0.5, 0.5, 0.9, 0.9] }
  ]);
  for (const element of result.elements) {
    assert.equal(Array.from(result.text).slice(element.start_offset, element.end_offset).join(''), element.text);
  }
});

test('projects one-page element geometry and keeps null fallback without elements', () => {
  const document = {
    ...envelope,
    text: 'Alpha Beta',
    elements: [
      { text: 'Alpha', start_offset: 0, end_offset: 5, page: 1, bounding_box: [0.1, 0.1, 0.3, 0.3] },
      { text: 'Beta', start_offset: 6, end_offset: 10, page: 1, bounding_box: [0.4, 0.4, 0.8, 0.8] }
    ]
  };
  const segmented = segmentDocument(document, { max_segment_chars: 100 });

  assert.deepEqual(segmented.segments[0].provenance.location, {
    page: 1,
    bounding_box: [0.1, 0.1, 0.8, 0.8],
    char_span: [0, 10]
  });

  const withoutElements = { ...envelope, text: document.text };
  assert.deepEqual(segmentDocument(withoutElements, { max_segment_chars: 100 }).segments[0].provenance.location, {
    page: null,
    bounding_box: null,
    char_span: [0, 10]
  });
});

test('keeps page and bounding box null for a segment crossing pages', () => {
  const document = {
    ...envelope,
    text: 'Pagina uno e pagina due',
    elements: [
      { text: 'Pagina uno', start_offset: 0, end_offset: 10, page: 1, bounding_box: [0, 0, 0.5, 0.5] },
      { text: 'pagina due', start_offset: 13, end_offset: 23, page: 2, bounding_box: [0.5, 0.5, 1, 1] }
    ]
  };

  assert.deepEqual(segmentDocument(document, { max_segment_chars: 100 }).segments[0].provenance.location, {
    page: null,
    bounding_box: null,
    char_span: [0, 23]
  });
});

test('rejects unsupported parsers, malformed envelopes, dimensions, pages, and boxes', () => {
  const valid = {
    parser_type: 'paddleocr',
    envelope,
    raw_json: {
      pages: [{ page: 1, width: 100, height: 100 }],
      blocks: [{ text: 'Valid', page: 1, bbox: [0, 0, 50, 50] }]
    }
  };

  assert.throws(() => normalizeParserOutput({ ...valid, parser_type: 'unknown' }), /parser_type/);
  assert.throws(() => normalizeParserOutput({ ...valid, envelope: { ...envelope, source_hash: 'bad' } }), /source_hash/);
  assert.throws(() => normalizeParserOutput({ ...valid, raw_json: { ...valid.raw_json, pages: [{ page: 1, width: 0, height: 100 }] } }), /dimension/);
  assert.throws(() => normalizeParserOutput({ ...valid, raw_json: { ...valid.raw_json, pages: [{ page: 0, width: 100, height: 100 }] } }), /page/);
  assert.throws(() => normalizeParserOutput({ ...valid, raw_json: { ...valid.raw_json, blocks: [{ text: 'Invalid', page: 1, bbox: [0, 0, 101, 50] }] } }), /box/);
  assert.throws(() => normalizeParserOutput({ ...valid, raw_json: { ...valid.raw_json, blocks: [{ text: 'Missing page', page: 2, bbox: [0, 0, 50, 50] }] } }), /page/);
});