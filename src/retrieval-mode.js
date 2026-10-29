const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]*$/;

function requireOpaqueId(value, name) {
  if (typeof value !== 'string' || !OPAQUE_ID_PATTERN.test(value)) {
    throw new TypeError(`${name} must be opaque`);
  }
}

function requireMatches(matches) {
  if (!Array.isArray(matches)) {
    throw new TypeError('matches must be an array');
  }
  matches.forEach((match, index) => {
    if (match === null || typeof match !== 'object' || Array.isArray(match)) {
      throw new TypeError(`matches[${index}] must be an object`);
    }
  });
}

function hasSemanticRank(match, index) {
  const rank = match.semantic_rank;
  if (rank === undefined || rank === null) {
    return false;
  }
  if (!Number.isInteger(rank) || rank <= 0) {
    throw new TypeError(`matches[${index}].semantic_rank must be a positive integer or null`);
  }
  return true;
}

/**
 * Describes the evidence present in matches a caller already holds. It reports
 * nothing about coverage: use inspectEmbeddingCoverage for that.
 */
export function describeRetrievalMode(matches, { model_id } = {}) {
  requireMatches(matches);
  if (model_id !== undefined) {
    requireOpaqueId(model_id, 'model_id');
  }
  const semantic_matches = matches.filter((match, index) => hasSemanticRank(match, index)).length;
  return {
    mode: matches.length === 0 ? 'empty' : semantic_matches > 0 ? 'hybrid' : 'lexical',
    model_id: model_id ?? null,
    matches: matches.length,
    semantic_matches
  };
}
