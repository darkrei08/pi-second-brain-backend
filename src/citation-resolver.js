import { createHash } from 'node:crypto';

const DOCUMENT_ID_PATTERN = /^urn:document:[A-Za-z0-9][A-Za-z0-9._~-]*$/;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const RAW_HASH_PATTERN = /^[0-9a-f]{64}$/;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]*$/;

function requireObject(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
}

function requireText(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be non-empty text`);
  }
}

function requireOpaqueId(value, name) {
  if (typeof value !== 'string' || !OPAQUE_ID_PATTERN.test(value)) {
    throw new TypeError(`${name} must be opaque`);
  }
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function validateLocation(location, result) {
  requireObject(location, 'provenance.location');
  if (!Number.isInteger(location.page) && location.page !== null) {
    throw new TypeError('location.page must be an integer or null');
  }
  if (location.page !== null && location.page < 1) {
    throw new TypeError('location.page must be positive');
  }
  if (location.bounding_box !== null) {
    if (!Array.isArray(location.bounding_box) || location.bounding_box.length !== 4 || location.bounding_box.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)) {
      throw new TypeError('location.bounding_box must contain four normalized numbers or null');
    }
    const [left, top, right, bottom] = location.bounding_box;
    if (left > right || top > bottom) {
      throw new TypeError('location.bounding_box must be ordered');
    }
  }
  if (!Array.isArray(location.char_span) || location.char_span.length !== 2 || !location.char_span.every((value) => Number.isInteger(value) && value >= 0)) {
    throw new TypeError('location.char_span must contain two non-negative integers');
  }
  if (location.char_span[0] !== result.start_offset || location.char_span[1] !== result.end_offset) {
    throw new TypeError('location.char_span does not match the result');
  }
}

function validateResult(result, ownerId, minConfidence) {
  requireObject(result, 'result');
  if (typeof result.document_id !== 'string' || !DOCUMENT_ID_PATTERN.test(result.document_id)) {
    throw new TypeError('result.document_id must be an opaque document URN');
  }
  requireText(result.id, 'result.id');
  if (!Number.isInteger(result.segment_index) || result.segment_index < 0) {
    throw new TypeError('result.segment_index must be a non-negative integer');
  }
  requireText(result.text, 'result.text');
  if (!RAW_HASH_PATTERN.test(result.text_sha256) || sha256(result.text) !== result.text_sha256) {
    throw new TypeError('result.text_sha256 does not match result.text');
  }
  if (!HASH_PATTERN.test(result.source_hash)) {
    throw new TypeError('result.source_hash must be a lowercase SHA-256 hash');
  }
  requireText(result.source_label, 'result.source_label');
  if (/[/\\\u0000-\u001f\u007f]/u.test(result.source_label) || result.source_label.includes('..')) {
    throw new TypeError('result.source_label must be sanitized');
  }
  requireOpaqueId(result.owner_id, 'result.owner_id');
  if (result.owner_id !== ownerId) {
    throw new TypeError('result owner_id does not match requested owner_id');
  }
  if (result.retention_state !== 'active') {
    throw new TypeError('result retention_state must be active');
  }
  if (!Number.isInteger(result.start_offset) || !Number.isInteger(result.end_offset) || result.start_offset < 0 || result.end_offset <= result.start_offset) {
    throw new TypeError('result offsets must be ordered non-negative integers');
  }

  const provenance = result.provenance;
  requireObject(provenance, 'result.provenance');
  if (provenance.segment_id !== result.id || provenance.sequence_index !== result.segment_index) {
    throw new TypeError('provenance segment identity does not match result');
  }
  if (provenance.source_hash !== result.source_hash) {
    throw new TypeError('provenance source_hash does not match result');
  }
  if (provenance.segment_hash !== `sha256:${result.text_sha256}`) {
    throw new TypeError('provenance segment_hash does not match result');
  }
  requireObject(provenance.lineage, 'provenance.lineage');
  requireText(provenance.lineage.parser, 'provenance.lineage.parser');
  if (provenance.lineage.model !== null) requireText(provenance.lineage.model, 'provenance.lineage.model');
  requireText(provenance.lineage.stage, 'provenance.lineage.stage');
  requireText(provenance.created_at, 'provenance.created_at');

  requireObject(provenance.retention, 'provenance.retention');
  if (provenance.retention.owner_id !== ownerId || provenance.retention.state !== 'active') {
    throw new TypeError('provenance retention does not match active owner');
  }

  requireObject(provenance.citation, 'provenance.citation');
  requireText(provenance.citation.label, 'provenance.citation.label');
  if (/[/\\\u0000-\u001f\u007f]/u.test(provenance.citation.label) || provenance.citation.label.includes('..')) {
    throw new TypeError('citation label must be sanitized');
  }
  const expectedRef = `[doc:${result.document_id}#seg${result.segment_index}]`;
  if (provenance.citation.ref !== expectedRef) {
    throw new TypeError('citation ref does not match result');
  }
  if (typeof provenance.citation.confidence !== 'number' || !Number.isFinite(provenance.citation.confidence) || provenance.citation.confidence < 0 || provenance.citation.confidence > 1 || provenance.citation.confidence < minConfidence) {
    throw new TypeError('citation confidence is below the accepted range');
  }
  validateLocation(provenance.location, result);
  return provenance;
}

export function resolveCitations(results, options) {
  if (!Array.isArray(results) || results.length === 0) {
    throw new TypeError('results must be a non-empty array');
  }
  requireObject(options, 'options');
  const { owner_id, min_confidence = 0 } = options;
  requireOpaqueId(owner_id, 'owner_id');
  if (typeof min_confidence !== 'number' || !Number.isFinite(min_confidence) || min_confidence < 0 || min_confidence > 1) {
    throw new TypeError('min_confidence must be between 0 and 1');
  }

  return results.map((result) => {
    const provenance = validateResult(result, owner_id, min_confidence);
    return {
      document_id: result.document_id,
      segment_id: result.id,
      text: result.text,
      citation: {
        label: provenance.citation.label,
        ref: provenance.citation.ref,
        confidence: provenance.citation.confidence,
        source_hash: result.source_hash,
        segment_hash: provenance.segment_hash,
        location: provenance.location,
        lineage: provenance.lineage
      }
    };
  });
}
