const DEFAULT_BACKFILL_LIMIT = 20;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]*$/;
const REQUIRED_STORAGE_METHODS = ['listEmbeddingBackfill', 'getDocumentWithSegments', 'saveSegmentEmbeddings'];

function requireObject(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
}

function requireOpaqueId(value, name) {
  if (typeof value !== 'string' || !OPAQUE_ID_PATTERN.test(value)) {
    throw new TypeError(`${name} must be opaque`);
  }
}

function validateInput(input) {
  requireObject(input, 'input');
  const { storage, embed, model_id, owner_id, limit = DEFAULT_BACKFILL_LIMIT } = input;
  for (const method of REQUIRED_STORAGE_METHODS) {
    if (!storage || typeof storage[method] !== 'function') {
      throw new TypeError(`storage must provide ${method}()`);
    }
  }
  if (typeof embed !== 'function') {
    throw new TypeError('embed must be a function');
  }
  requireOpaqueId(model_id, 'model_id');
  requireOpaqueId(owner_id, 'owner_id');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new TypeError('limit must be an integer between 1 and 100');
  }
  return { storage, embed, model_id, owner_id, limit };
}

function describedSegmentIds(document) {
  return document.segments.map(({ id }) => id);
}

function matchesPlan(document, planned) {
  const segmentIds = describedSegmentIds(document);
  return segmentIds.length === planned.segment_ids.length &&
    segmentIds.every((segmentId, index) => segmentId === planned.segment_ids[index]);
}

export async function runEmbeddingBackfill(input) {
  const { storage, embed, model_id, owner_id, limit } = validateInput(input);
  const plan = await storage.listEmbeddingBackfill({ model_id, owner_id, limit });
  const skipped_documents = [];
  let processed_documents = 0;
  let embedded_segments = 0;

  for (const planned of plan.documents) {
    const document = await storage.getDocumentWithSegments(planned.document_id, owner_id);
    if (!document) {
      skipped_documents.push({ document_id: planned.document_id, reason: 'document is not readable' });
      continue;
    }
    if (document.retention?.state !== 'active') {
      skipped_documents.push({ document_id: planned.document_id, reason: 'document is not active' });
      continue;
    }
    if (!matchesPlan(document, planned)) {
      skipped_documents.push({ document_id: planned.document_id, reason: 'document changed since the plan' });
      continue;
    }
    //shortcut: the whole document is embedded in one call, batch the inputs when a provider caps request size.
    const vectors = await embed({
      model_id,
      dimensions: plan.dimensions,
      inputs: document.segments.map(({ text }) => text)
    });
    if (!Array.isArray(vectors) || vectors.length !== document.segments.length) {
      throw new Error('embed must return one vector per input segment');
    }
    await storage.saveSegmentEmbeddings({
      document_id: document.document_id,
      owner_id,
      model_id,
      dimensions: plan.dimensions,
      embeddings: document.segments.map((segment, index) => ({
        segment_id: segment.id,
        embedding: vectors[index]
      })),
      created_at: document.created_at
    });
    processed_documents += 1;
    embedded_segments += document.segments.length;
  }

  return {
    model_id,
    owner_id,
    dimensions: plan.dimensions,
    processed_documents,
    embedded_segments,
    skipped_documents
  };
}
