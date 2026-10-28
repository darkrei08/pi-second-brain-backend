const PARSER_TYPES = new Set(['docling', 'mineru', 'paddleocr']);
const DOCUMENT_ID_PATTERN = /^urn:document:[A-Za-z0-9][A-Za-z0-9._~-]*$/;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]*$/;
const RETENTION_STATES = new Set(['active', 'tombstone', 'purged']);
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

function fail(message) {
  throw new TypeError(message);
}

function requireObject(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object`);
}

function requireArray(value, name) {
  if (!Array.isArray(value) || value.length === 0) fail(`${name} must be a non-empty array`);
}

function requireText(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) fail(`${name} must be non-empty text`);
}

function requireFinitePositive(value, name) {
  if (!Number.isFinite(value) || value <= 0) fail(`${name} must be a positive finite number`);
}

function validateEnvelope(envelope) {
  requireObject(envelope, 'envelope');
  if (typeof envelope.document_id !== 'string' || !DOCUMENT_ID_PATTERN.test(envelope.document_id)) fail('envelope.document_id is invalid');
  requireText(envelope.source_label, 'envelope.source_label');
  if (/[/\\\u0000-\u001f\u007f]/u.test(envelope.source_label) || envelope.source_label !== envelope.source_label.trim() || envelope.source_label.includes('..')) fail('envelope.source_label is invalid');
  if (typeof envelope.source_hash !== 'string' || !HASH_PATTERN.test(envelope.source_hash)) fail('envelope.source_hash is invalid');
  requireObject(envelope.lineage, 'envelope.lineage');
  requireText(envelope.lineage.parser, 'envelope.lineage.parser');
  if (envelope.lineage.model !== null && (typeof envelope.lineage.model !== 'string' || envelope.lineage.model.trim().length === 0)) fail('envelope.lineage.model is invalid');
  if (typeof envelope.created_at !== 'string' || !RFC3339_PATTERN.test(envelope.created_at) || Number.isNaN(Date.parse(envelope.created_at))) fail('envelope.created_at is invalid');
  requireObject(envelope.retention, 'envelope.retention');
  if (typeof envelope.retention.owner_id !== 'string' || !OPAQUE_ID_PATTERN.test(envelope.retention.owner_id)) fail('envelope.retention.owner_id is invalid');
  if (!RETENTION_STATES.has(envelope.retention.state)) fail('envelope.retention.state is invalid');
}

function requirePageId(value, name, minimum) {
  if (!Number.isInteger(value) || value < minimum) fail(`${name} is invalid`);
}

function pageDimensions(page, name) {
  requireObject(page, name);
  const size = page.size ?? page.page_size;
  const width = page.width ?? size?.[0] ?? size?.width;
  const height = page.height ?? size?.[1] ?? size?.height;
  requireFinitePositive(width, `${name}.dimension.width`);
  requireFinitePositive(height, `${name}.dimension.height`);
  return { width, height };
}

function pagesById(rawPages, parserType) {
  requireArray(rawPages, 'raw_json.pages');
  const pages = new Map();
  for (const [index, rawPage] of rawPages.entries()) {
    const dimensions = pageDimensions(rawPage, `raw_json.pages[${index}]`);
    let id;
    if (parserType === 'docling') id = rawPage.page_no ?? rawPage.page_number ?? rawPage.page ?? index + 1;
    else if (parserType === 'mineru') id = rawPage.page_idx ?? rawPage.page_index ?? index;
    else id = rawPage.page ?? rawPage.page_num ?? rawPage.page_number ?? index + 1;
    requirePageId(id, `raw_json.pages[${index}].page`, parserType === 'mineru' ? 0 : 1);
    if (pages.has(id)) fail('raw_json.pages contains duplicate pages');
    pages.set(id, { id, ...dimensions });
  }
  return pages;
}

function pageFor(blockPage, pages, parserType, name) {
  let id = blockPage;
  if (id === undefined || id === null) {
    if (pages.size !== 1) return null;
    id = pages.keys().next().value;
  }
  if (parserType === 'mineru') requirePageId(id, `${name}.page_idx`, 0);
  else requirePageId(id, `${name}.page`, 1);
  const page = pages.get(id);
  if (!page) fail(`${name}.page refers to an unknown page`);
  return page;
}

function textValue(block, name) {
  const text = block.text ?? block.content;
  requireText(text, `${name}.text`);
  return text;
}

function boxValues(value, name) {
  if (Array.isArray(value)) {
    if (value.length !== 4 || value.some((item) => !Number.isFinite(item))) fail(`${name} is invalid`);
    return value;
  }
  requireObject(value, name);
  const values = [value.l ?? value.left, value.t ?? value.top, value.r ?? value.right, value.b ?? value.bottom];
  if (values.some((item) => !Number.isFinite(item))) fail(`${name} is invalid`);
  return values;
}

function validateBox([left, top, right, bottom], maxWidth, maxHeight, name) {
  if (left < 0 || top < 0 || right > maxWidth || bottom > maxHeight || left >= right || top >= bottom) fail(`${name} is invalid`);
}

function normalizeDoclingBox(value, page, origin, name) {
  if (value === undefined || value === null) return null;
  if (origin !== 'BOTTOMLEFT' && origin !== 'TOPLEFT') fail(`${name}.coord_origin is invalid`);
  const [left, y1, right, y2] = boxValues(value, `${name}.bbox`);
  validateBox([left, y1, right, y2], page.width, page.height, `${name}.bbox`);
  const top = origin === 'BOTTOMLEFT' ? page.height - y2 : y1;
  const bottom = origin === 'BOTTOMLEFT' ? page.height - y1 : y2;
  return [left / page.width, top / page.height, right / page.width, bottom / page.height];
}

function normalizeMinerBox(value, name) {
  if (value === undefined || value === null) return null;
  const box = boxValues(value, `${name}.bbox`);
  validateBox(box, 1000, 1000, `${name}.bbox`);
  return box.map((item) => item / 1000);
}

function normalizePaddleBox(value, page, name) {
  if (value === undefined || value === null) return null;
  const box = boxValues(value, `${name}.bbox`);
  validateBox(box, page.width, page.height, `${name}.bbox`);
  return [box[0] / page.width, box[1] / page.height, box[2] / page.width, box[3] / page.height];
}

function doclingBlocks(rawJson, pages) {
  requireArray(rawJson.texts ?? rawJson.blocks, 'raw_json.texts');
  return (rawJson.texts ?? rawJson.blocks).map((block, index) => {
    requireObject(block, `raw_json.texts[${index}]`);
    const provenance = Array.isArray(block.prov) ? block.prov[0] : block.prov ?? block.provenance;
    if (provenance !== undefined && provenance !== null) requireObject(provenance, `raw_json.texts[${index}].prov`);
    const page = pageFor(provenance?.page_no ?? provenance?.page_number ?? block.page_no ?? block.page_number, pages, 'docling', `raw_json.texts[${index}]`);
    const bbox = provenance?.bbox ?? block.bbox;
    const origin = provenance?.coord_origin ?? block.coord_origin ?? 'BOTTOMLEFT';
    return { text: textValue(block, `raw_json.texts[${index}]`), page: page?.id ?? null, bounding_box: page ? normalizeDoclingBox(bbox, page, origin, `raw_json.texts[${index}]`) : null };
  });
}

function mineruBlocks(rawJson, pages) {
  requireArray(rawJson.content_list ?? rawJson.blocks, 'raw_json.content_list');
  return (rawJson.content_list ?? rawJson.blocks).filter((block) => block && (block.text !== undefined || block.content !== undefined)).map((block, index) => {
    requireObject(block, `raw_json.content_list[${index}]`);
    const page = pageFor(block.page_idx ?? block.page_index, pages, 'mineru', `raw_json.content_list[${index}]`);
    return { text: textValue(block, `raw_json.content_list[${index}]`), page: page ? page.id + 1 : null, bounding_box: page ? normalizeMinerBox(block.bbox ?? block.box, `raw_json.content_list[${index}]`) : null };
  });
}

function paddleBlocks(rawJson, pages) {
  const topLevel = rawJson.blocks ?? rawJson.texts;
  const blocks = topLevel ?? rawJson.pages.flatMap((page, pageIndex) => {
    const pageId = page.page ?? page.page_num ?? page.page_number ?? pageIndex + 1;
    return (page.blocks ?? page.texts ?? []).map((block) => ({
      ...block,
      page: block.page ?? block.page_num ?? block.page_number ?? (block.page_index === undefined ? pageId : undefined)
    }));
  });
  requireArray(blocks, 'raw_json.blocks');
  return blocks.map((block, index) => {
    requireObject(block, `raw_json.blocks[${index}]`);
    const pageValue = block.page ?? block.page_num ?? block.page_number;
    const page = pageFor(pageValue === undefined ? (block.page_index === undefined ? undefined : block.page_index + 1) : pageValue, pages, 'paddleocr', `raw_json.blocks[${index}]`);
    return { text: textValue(block, `raw_json.blocks[${index}]`), page: page?.id ?? null, bounding_box: page ? normalizePaddleBox(block.bbox ?? block.box, page, `raw_json.blocks[${index}]`) : null };
  });
}

function parserBlocks(parserType, rawJson) {
  requireObject(rawJson, 'raw_json');
  const pages = pagesById(rawJson.pages, parserType);
  if (parserType === 'docling') return doclingBlocks(rawJson, pages);
  if (parserType === 'mineru') return mineruBlocks(rawJson, pages);
  return paddleBlocks(rawJson, pages);
}

export function normalizeParserOutput({ parser_type, raw_json, envelope } = {}) {
  if (!PARSER_TYPES.has(parser_type)) fail('parser_type is unsupported');
  validateEnvelope(envelope);
  const blocks = parserBlocks(parser_type, raw_json);
  if (blocks.length === 0) fail('raw_json must contain text blocks');

  let offset = 0;
  const elements = blocks.map((block, index) => {
    if (index > 0) offset += 2;
    const start_offset = offset;
    offset += Array.from(block.text).length;
    return { ...block, start_offset, end_offset: offset };
  });

  return { ...envelope, text: blocks.map(({ text }) => text).join('\n\n'), elements };
}
