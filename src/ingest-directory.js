import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { segmentDocument } from './segment-document.js';

const COLLECTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]*$/u;
const DEFAULT_MAX_SEGMENT_CHARS = 1200;
const REQUEST_TIMEOUT_MS = 10_000;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function requireCollectionId(collection_id) {
  if (typeof collection_id !== 'string' || !COLLECTION_ID_PATTERN.test(collection_id)) {
    throw new TypeError('collection_id must be an opaque collection id');
  }
}

function gatewayUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError('gateway_url must be an HTTP or HTTPS URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new TypeError('gateway_url must be an HTTP or HTTPS URL without credentials or query parameters');
  }
  return parsed.toString().replace(/\/$/u, '');
}

async function prepareDocuments(directory, collection_id, max_segment_chars) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    throw new Error(`Cannot read directory: ${directory}`);
  }

  const documents = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const file_path = join(directory, entry.name);
    let file_stat;
    let bytes;
    try {
      file_stat = await lstat(file_path);
      if (!file_stat.isFile()) throw new Error('not a regular file');
      bytes = await readFile(file_path);
    } catch {
      throw new Error(`Cannot read file ${entry.name}`);
    }

    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new Error(`Cannot decode file ${entry.name} as UTF-8`);
    }

    const source_hash = `sha256:${sha256(bytes)}`;
    const document_hash = sha256(Buffer.concat([Buffer.from(`${entry.name}\0`, 'utf8'), bytes]));
    const document = {
      document_id: `urn:document:file-${document_hash}`,
      text,
      source_label: entry.name,
      source_hash,
      lineage: { parser: 'text-native@1.0.0', model: null },
      created_at: file_stat.mtime.toISOString(),
      collections: [collection_id]
    };

    // Validate every file before the first request so malformed batches cannot partially ingest.
    const validation_document = {
      ...document,
      retention: { owner_id: 'directory-ingest-validation', state: 'active' }
    };
    segmentDocument(validation_document, { max_segment_chars });
    documents.push(document);
  }

  if (documents.length === 0) throw new Error('The directory contains no files');
  return documents;
}

export async function ingestDirectory({
  directory,
  collection_id,
  gateway_url = 'http://127.0.0.1:8080',
  gateway_token,
  max_segment_chars = DEFAULT_MAX_SEGMENT_CHARS
}) {
  if (typeof directory !== 'string' || directory.trim() === '') throw new TypeError('directory must be non-empty text');
  requireCollectionId(collection_id);
  if (typeof gateway_token !== 'string' || gateway_token === '') throw new TypeError('gateway_token is required');
  if (!Number.isInteger(max_segment_chars) || max_segment_chars < 1) {
    throw new TypeError('max_segment_chars must be a positive integer');
  }

  const base_url = gatewayUrl(gateway_url);
  const documents = await prepareDocuments(directory, collection_id, max_segment_chars);
  for (const document of documents) {
    let response;
    try {
      response = await fetch(`${base_url}/v1/documents/ingest`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${gateway_token}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ document, max_segment_chars }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch {
      throw new Error(`Gateway refused ${document.source_label}: request failed`);
    }

    if (!response.ok) {
      let message = 'The request failed';
      try {
        const payload = await response.json();
        if (typeof payload?.error?.message === 'string') message = payload.error.message;
      } catch {
        // Keep the stable readable fallback.
      }
      throw new Error(`Gateway refused ${document.source_label}: ${message}`);
    }
  }

  return { collection_id, documents: documents.length };
}
