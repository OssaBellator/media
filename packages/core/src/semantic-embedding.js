import { normalizeBoundedModelInput, normalizeBoundedModelJsonObject } from './model-input.js';
import { normalizeModelRoutingPolicy } from './model-router.js';
import { operationLogChecksum } from './operation-log.js';
import { createPlannerSnapshot } from './providers.js';
import {
  MAX_SEMANTIC_KIND_CHARS,
  MAX_SEMANTIC_KIND_FILTERS,
  MAX_SEMANTIC_QUERY_CHARS,
  MAX_SEMANTIC_SEARCH_RESULTS,
  createSemanticIndex,
  searchSemanticGraph,
} from './semantic-search.js';

export const SEMANTIC_EMBEDDING_INDEX_SCHEMA = 'media.semantic-embedding-index.v1';
export const MAX_SEMANTIC_EMBEDDING_DIMENSIONS = 4096;
export const MAX_SEMANTIC_EMBEDDING_DOCUMENTS = 4096;
export const MAX_SEMANTIC_EMBEDDING_SCALARS = 2_000_000;
const SEMANTIC_EMBEDDING_SOURCE_SCHEMA = 'media.semantic-embedding-source.v1';
const SEMANTIC_EMBEDDING_CACHE_SCHEMA = 'media.semantic-embedding-cache-key.v1';
const DEFAULT_BATCH_SIZE = 32;
const MAX_DOCUMENT_TEXT_CHARS = 4096;
const MAX_EMBED_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_EMBED_OUTPUT_ENTRIES = 1_100_000;
const MAX_EMBED_METADATA_BYTES = 64 * 1024;
const EMBED_OUTPUT_KEYS = new Set(['vectors', 'metadata']);
const SOURCE_OPTION_KEYS = new Set(['kinds']);
const CACHE_KEY_OPTION_KEYS = new Set(['projectId', 'sourceFingerprint', 'backendId', 'kinds']);
const INDEX_EXPECTATION_KEYS = new Set(['projectId', 'sourceFingerprint', 'backendId']);
const CREATE_OPTION_KEYS = new Set(['policy', 'kinds', 'maxDocuments', 'maxScalars', 'batchSize', 'signal']);
const SEARCH_OPTION_KEYS = new Set(['limit', 'kinds', 'minimumScore']);
const QUERY_OPTION_KEYS = new Set(['policy', 'signal', 'limit', 'kinds', 'minimumScore']);
const HYBRID_OPTION_KEYS = new Set(['limit', 'kinds', 'lexicalWeight', 'embeddingWeight']);
const EMBEDDING_INDEX_KEYS = new Set(['schema', 'projectId', 'sourceFingerprint', 'backendId', 'dimensions', 'documents', 'routing']);
const EMBEDDING_DOCUMENT_KEYS = new Set(['id', 'kind', 'name', 'vector']);
const EMBEDDING_ROUTE_KEYS = new Set(['backendId', 'count']);
const MAX_EMBEDDING_INDEX_BYTES = 32 * 1024 * 1024;
const MAX_EMBEDDING_INDEX_ENTRIES = 2_100_000;

function requireRouter(router) {
  if (!router || typeof router.execute !== 'function') throw new Error('Semantic embedding requires a model router');
  return router;
}
function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}
function dataOptions(value, label, allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a plain data object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} must be a plain data object`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const clean = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !allowedKeys.has(key)) throw new Error(`Unsupported ${label} field: ${String(key)}`);
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error(`${label} must contain enumerable data fields only`);
    Object.defineProperty(clean, key, { value: descriptor.value, enumerable: true, writable: true, configurable: true });
  }
  return clean;
}
function boundedInteger(value, label, fallback, max) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`${label} must be an integer between 1 and ${max}`);
  return value;
}
function finiteNumber(value, label, fallback, min = -Infinity, max = Infinity) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be a finite number between ${min} and ${max}`);
  return value;
}
function normalizeKinds(kinds) {
  if (kinds == null) return null;
  if (!Array.isArray(kinds) || kinds.length > MAX_SEMANTIC_KIND_FILTERS) throw new Error(`Semantic embedding kinds must be an array with at most ${MAX_SEMANTIC_KIND_FILTERS} entries`);
  const normalized = [];
  for (let index = 0; index < kinds.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(kinds, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('Semantic embedding kinds must contain enumerable data values only');
    const kind = requireString(descriptor.value, 'Semantic embedding kind');
    if (kind.length > MAX_SEMANTIC_KIND_CHARS) throw new Error(`Semantic embedding kind exceeds ${MAX_SEMANTIC_KIND_CHARS} characters`);
    normalized.push(kind);
  }
  return [...new Set(normalized)].sort();
}
function rejectUnknownFields(value, allowedKeys, label) {
  for (const key of Object.keys(value)) if (!allowedKeys.has(key)) throw new Error(`Unsupported ${label} field: ${key}`);
}
function embeddingText(document) {
  const terms = Object.keys(document.terms ?? {}).slice(0, 256).join(' ');
  return `${document.name}\n${document.kind}\n${terms}`.slice(0, MAX_DOCUMENT_TEXT_CHARS);
}
function embeddingSource(graph, kinds) {
  const safeGraph = createPlannerSnapshot(graph);
  const lexical = createSemanticIndex(safeGraph, { kinds });
  const payload = {
    schema: SEMANTIC_EMBEDDING_SOURCE_SCHEMA,
    projectId: requireString(graph?.projectId, 'Semantic embedding projectId'),
    kinds,
    documents: lexical.documents.map((document) => ({
      id: document.id,
      kind: document.kind,
      name: document.name,
      text: embeddingText(document),
    })),
  };
  return { lexical, sourceFingerprint: operationLogChecksum(payload) };
}
function validateVector(vector, expectedDimensions = null) {
  if (!Array.isArray(vector) && !ArrayBuffer.isView(vector)) throw new Error('Embedding vector must be an array');
  const values = Array.from(vector);
  if (!values.length || values.length > MAX_SEMANTIC_EMBEDDING_DIMENSIONS) throw new Error(`Embedding vector dimensions must be between 1 and ${MAX_SEMANTIC_EMBEDDING_DIMENSIONS}`);
  if (expectedDimensions != null && values.length !== expectedDimensions) throw new Error(`Embedding vector dimensions ${values.length} do not match expected ${expectedDimensions}`);
  if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Embedding vector values must be finite numbers');
  return values;
}
function normalizeEmbedOutput(output, expectedCount, expectedDimensions = null) {
  const safe = normalizeBoundedModelInput(output, 'Embedding backend output', {
    maxBytes: MAX_EMBED_OUTPUT_BYTES,
    maxEntries: MAX_EMBED_OUTPUT_ENTRIES,
    maxDepth: 24,
    allowBinary: true,
  });
  if (!safe || typeof safe !== 'object' || Array.isArray(safe)) throw new Error('Embedding backend output must be an object');
  for (const key of Object.keys(safe)) if (!EMBED_OUTPUT_KEYS.has(key)) throw new Error(`Unsupported embedding backend output field: ${key}`);
  const vectors = safe.vectors;
  if (!Array.isArray(vectors) || vectors.length !== expectedCount) throw new Error(`Embedding backend must return exactly ${expectedCount} vectors`);
  let dimensions = expectedDimensions;
  const normalized = vectors.map((vector) => {
    const clean = validateVector(vector, dimensions);
    dimensions ??= clean.length;
    return clean;
  });
  const metadata = safe.metadata === undefined ? {} : normalizeBoundedModelJsonObject(safe.metadata, 'Embedding backend metadata', { maxBytes: MAX_EMBED_METADATA_BYTES });
  return { vectors: normalized, dimensions, metadata };
}
function cosine(a, b) {
  let dot = 0; let aa = 0; let bb = 0;
  for (let index = 0; index < a.length; index += 1) { dot += a[index] * b[index]; aa += a[index] ** 2; bb += b[index] ** 2; }
  if (aa === 0 || bb === 0) return 0;
  return dot / Math.sqrt(aa * bb);
}

export function semanticEmbeddingSourceFingerprint(graph, options = {}) {
  const config = dataOptions(options, 'Semantic embedding source options', SOURCE_OPTION_KEYS);
  const normalizedKinds = normalizeKinds(config.kinds ?? null);
  return embeddingSource(graph, normalizedKinds).sourceFingerprint;
}

export function semanticEmbeddingCacheKey(options = {}) {
  const config = dataOptions(options, 'Semantic embedding cache key options', CACHE_KEY_OPTION_KEYS);
  const payload = {
    schema: SEMANTIC_EMBEDDING_CACHE_SCHEMA,
    projectId: requireString(config.projectId, 'Semantic embedding cache projectId'),
    sourceFingerprint: requireString(config.sourceFingerprint, 'Semantic embedding cache source fingerprint'),
    backendId: requireString(config.backendId, 'Semantic embedding cache backend id'),
    kinds: normalizeKinds(config.kinds ?? null),
  };
  return `semantic-embedding:${operationLogChecksum(payload)}`;
}

export function assertSemanticEmbeddingIndex(index, options = {}) {
  const config = dataOptions(options, 'Semantic embedding index expectations', INDEX_EXPECTATION_KEYS);
  const projectId = config.projectId ?? null;
  const sourceFingerprint = config.sourceFingerprint ?? null;
  const backendId = config.backendId ?? null;
  if (projectId != null) requireString(projectId, 'Expected semantic embedding projectId');
  if (sourceFingerprint != null) requireString(sourceFingerprint, 'Expected semantic embedding source fingerprint');
  if (backendId != null) requireString(backendId, 'Expected semantic embedding backend id');
  const safe = normalizeBoundedModelInput(index, 'Semantic embedding index', {
    maxBytes: MAX_EMBEDDING_INDEX_BYTES,
    maxEntries: MAX_EMBEDDING_INDEX_ENTRIES,
    maxDepth: 6,
    allowBinary: true,
  });
  if (!safe || typeof safe !== 'object' || Array.isArray(safe) || safe.schema !== SEMANTIC_EMBEDDING_INDEX_SCHEMA) throw new Error('A valid semantic embedding index is required');
  rejectUnknownFields(safe, EMBEDDING_INDEX_KEYS, 'semantic embedding index');
  requireString(safe.projectId, 'Semantic embedding index projectId');
  requireString(safe.sourceFingerprint, 'Semantic embedding index source fingerprint');
  if (safe.backendId != null) requireString(safe.backendId, 'Semantic embedding index backend id');
  if (projectId != null && safe.projectId !== projectId) throw new Error('Semantic embedding index projectId does not match expected project');
  if (sourceFingerprint != null && safe.sourceFingerprint !== sourceFingerprint) throw new Error('Semantic embedding index source fingerprint does not match expected source');
  if (backendId != null && safe.backendId !== backendId) throw new Error('Semantic embedding index backend id does not match expected backend');
  if (!Number.isSafeInteger(safe.dimensions) || safe.dimensions < 0 || safe.dimensions > MAX_SEMANTIC_EMBEDDING_DIMENSIONS) throw new Error('Semantic embedding index dimensions are invalid');
  if (!Array.isArray(safe.documents) || safe.documents.length > MAX_SEMANTIC_EMBEDDING_DOCUMENTS) throw new Error('Semantic embedding index documents are invalid');
  if (safe.documents.length && (!safe.dimensions || !safe.backendId)) throw new Error('Semantic embedding index with documents requires dimensions and backend id');
  if (safe.documents.length * safe.dimensions > MAX_SEMANTIC_EMBEDDING_SCALARS) throw new Error(`Semantic embedding index exceeds ${MAX_SEMANTIC_EMBEDDING_SCALARS} scalar values`);
  const ids = new Set();
  for (const document of safe.documents) {
    if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('Semantic embedding document must be an object');
    rejectUnknownFields(document, EMBEDDING_DOCUMENT_KEYS, 'semantic embedding document');
    const id = requireString(document.id, 'Semantic embedding document id');
    if (ids.has(id)) throw new Error(`Semantic embedding document id is duplicated: ${id}`);
    ids.add(id);
    requireString(document.kind, 'Semantic embedding document kind');
    if (typeof document.name !== 'string') throw new Error('Semantic embedding document name must be a string');
    document.vector = validateVector(document.vector, safe.dimensions);
  }
  if (safe.routing !== undefined) {
    if (!Array.isArray(safe.routing) || safe.routing.length > MAX_SEMANTIC_EMBEDDING_DOCUMENTS) throw new Error('Semantic embedding routing must be a bounded array');
    let routedDocuments = 0;
    for (const route of safe.routing) {
      if (!route || typeof route !== 'object' || Array.isArray(route)) throw new Error('Semantic embedding routing entry must be an object');
      rejectUnknownFields(route, EMBEDDING_ROUTE_KEYS, 'semantic embedding routing');
      const routeBackendId = requireString(route.backendId, 'Semantic embedding routing backend id');
      if (safe.backendId && routeBackendId !== safe.backendId) throw new Error('Semantic embedding routing backend does not match index backend');
      if (!Number.isSafeInteger(route.count) || route.count < 1) throw new Error('Semantic embedding routing count must be a positive safe integer');
      routedDocuments += route.count;
    }
    if (routedDocuments !== safe.documents.length) throw new Error('Semantic embedding routing counts do not match index documents');
  }
  return safe;
}

export async function createSemanticEmbeddingIndex(graph, router, options = {}) {
  requireRouter(router);
  const config = dataOptions(options, 'Semantic embedding create options', CREATE_OPTION_KEYS);
  const normalizedKinds = normalizeKinds(config.kinds ?? null);
  const documentLimit = boundedInteger(config.maxDocuments, 'Semantic embedding maxDocuments', 1024, MAX_SEMANTIC_EMBEDDING_DOCUMENTS);
  const scalarLimit = boundedInteger(config.maxScalars, 'Semantic embedding maxScalars', MAX_SEMANTIC_EMBEDDING_SCALARS, MAX_SEMANTIC_EMBEDDING_SCALARS);
  const size = boundedInteger(config.batchSize, 'Semantic embedding batchSize', DEFAULT_BATCH_SIZE, 256);
  const policy = normalizeModelRoutingPolicy(config.policy ?? {});
  const signal = config.signal;
  const source = embeddingSource(graph, normalizedKinds);
  const sourceDocuments = source.lexical.documents.slice(0, documentLimit);
  const documents = [];
  const routing = [];
  let dimensions = null;
  let scalars = 0;
  let backendId = null;
  for (let start = 0; start < sourceDocuments.length; start += size) {
    const batch = sourceDocuments.slice(start, start + size);
    const texts = batch.map(embeddingText);
    const routed = await router.execute('embed', { texts }, { signal, policy, context: { purpose: 'semantic-index', projectId: graph.projectId } });
    if (backendId == null) backendId = routed.backendId;
    else if (routed.backendId !== backendId) throw new Error(`Semantic embedding backend changed during index build: ${backendId} -> ${routed.backendId}`);
    const normalized = normalizeEmbedOutput(routed.output, batch.length, dimensions);
    dimensions ??= normalized.dimensions;
    scalars += batch.length * dimensions;
    if (scalars > scalarLimit) throw new Error(`Semantic embedding index exceeds ${scalarLimit} scalar values`);
    for (let index = 0; index < batch.length; index += 1) documents.push({ id: batch[index].id, kind: batch[index].kind, name: batch[index].name, vector: normalized.vectors[index] });
    routing.push({ backendId: routed.backendId, count: batch.length });
  }
  if (backendId == null && typeof router.list === 'function') backendId = router.list('embed', policy)[0]?.id ?? null;
  return assertSemanticEmbeddingIndex({
    schema: SEMANTIC_EMBEDDING_INDEX_SCHEMA,
    projectId: graph.projectId,
    sourceFingerprint: source.sourceFingerprint,
    backendId,
    dimensions: dimensions ?? 0,
    documents,
    routing,
  });
}

export function searchSemanticEmbeddingIndex(index, queryVector, options = {}) {
  const safeIndex = assertSemanticEmbeddingIndex(index);
  const config = dataOptions(options, 'Semantic embedding search options', SEARCH_OPTION_KEYS);
  if (!safeIndex.dimensions) return [];
  const query = validateVector(queryVector, safeIndex.dimensions);
  const normalizedKinds = normalizeKinds(config.kinds ?? null);
  const allowed = normalizedKinds == null ? null : new Set(normalizedKinds);
  const maxResults = boundedInteger(config.limit, 'Semantic embedding search limit', 20, MAX_SEMANTIC_SEARCH_RESULTS);
  const threshold = finiteNumber(config.minimumScore, 'Semantic embedding minimumScore', -1, -1, 1);
  return safeIndex.documents
    .filter((document) => !allowed || allowed.has(document.kind))
    .map((document) => ({ id: document.id, kind: document.kind, name: document.name, score: cosine(query, document.vector) }))
    .filter((result) => result.score >= threshold)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .slice(0, maxResults);
}

export async function embedSemanticQuery(router, index, query, options = {}) {
  requireRouter(router);
  const safeIndex = assertSemanticEmbeddingIndex(index);
  const config = dataOptions(options, 'Semantic embedding query options', QUERY_OPTION_KEYS);
  if (typeof query !== 'string') throw new Error('Semantic embedding query must be a string');
  if (query.length > MAX_SEMANTIC_QUERY_CHARS) throw new Error(`Semantic embedding query exceeds ${MAX_SEMANTIC_QUERY_CHARS} characters`);
  if (!query.trim()) return [];
  const cleanPolicy = normalizeModelRoutingPolicy(config.policy ?? {});
  const signal = config.signal;
  const limit = boundedInteger(config.limit, 'Semantic embedding query limit', 20, MAX_SEMANTIC_SEARCH_RESULTS);
  const kinds = normalizeKinds(config.kinds ?? null);
  const minimumScore = finiteNumber(config.minimumScore, 'Semantic embedding query minimumScore', -1, -1, 1);
  const callerAllowed = cleanPolicy.allowedBackendIds == null ? null : new Set(cleanPolicy.allowedBackendIds);
  const queryPolicy = safeIndex.backendId
    ? { ...cleanPolicy, allowedBackendIds: callerAllowed == null || callerAllowed.has(safeIndex.backendId) ? [safeIndex.backendId] : [] }
    : cleanPolicy;
  const routed = await router.execute('embed', { texts: [query.trim()] }, { signal, policy: queryPolicy, context: { purpose: 'semantic-query', projectId: safeIndex.projectId } });
  if (safeIndex.backendId && routed.backendId !== safeIndex.backendId) throw new Error(`Semantic query backend ${routed.backendId} does not match index backend ${safeIndex.backendId}`);
  const normalized = normalizeEmbedOutput(routed.output, 1, safeIndex.dimensions);
  return searchSemanticEmbeddingIndex(safeIndex, normalized.vectors[0], { limit, kinds, minimumScore }).map((result) => ({ ...result, backendId: routed.backendId }));
}

export function searchSemanticHybrid(graph, embeddingIndex, query, queryVector, options = {}) {
  const config = dataOptions(options, 'Semantic hybrid search options', HYBRID_OPTION_KEYS);
  const maxResults = boundedInteger(config.limit, 'Semantic hybrid search limit', 20, MAX_SEMANTIC_SEARCH_RESULTS);
  const kinds = normalizeKinds(config.kinds ?? null);
  const lexicalWeight = finiteNumber(config.lexicalWeight, 'Semantic hybrid lexicalWeight', 1, 0);
  const embeddingWeight = finiteNumber(config.embeddingWeight, 'Semantic hybrid embeddingWeight', 1, 0);
  const lexical = searchSemanticGraph(graph, query, { limit: Math.min(MAX_SEMANTIC_SEARCH_RESULTS, maxResults * 4), kinds });
  const embedded = searchSemanticEmbeddingIndex(embeddingIndex, queryVector, { limit: Math.min(MAX_SEMANTIC_SEARCH_RESULTS, maxResults * 4), kinds });
  const scores = new Map();
  const metadata = new Map();
  lexical.forEach((result, index) => {
    scores.set(result.id, (scores.get(result.id) ?? 0) + lexicalWeight / (60 + index + 1));
    metadata.set(result.id, { id: result.id, kind: result.kind, name: result.name });
  });
  embedded.forEach((result, index) => {
    scores.set(result.id, (scores.get(result.id) ?? 0) + embeddingWeight / (60 + index + 1));
    metadata.set(result.id, { id: result.id, kind: result.kind, name: result.name });
  });
  return [...scores.entries()].map(([id, score]) => ({ ...metadata.get(id), score })).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).slice(0, maxResults);
}
