import { normalizeModelRoutingPolicy } from './model-router.js';
import { operationLogChecksum } from './operation-log.js';
import { createPlannerSnapshot } from './providers.js';
import { createSemanticIndex, searchSemanticGraph } from './semantic-search.js';

export const SEMANTIC_EMBEDDING_INDEX_SCHEMA = 'media.semantic-embedding-index.v1';
export const MAX_SEMANTIC_EMBEDDING_DIMENSIONS = 4096;
export const MAX_SEMANTIC_EMBEDDING_DOCUMENTS = 4096;
export const MAX_SEMANTIC_EMBEDDING_SCALARS = 2_000_000;
const SEMANTIC_EMBEDDING_SOURCE_SCHEMA = 'media.semantic-embedding-source.v1';
const SEMANTIC_EMBEDDING_CACHE_SCHEMA = 'media.semantic-embedding-cache-key.v1';
const DEFAULT_BATCH_SIZE = 32;
const MAX_DOCUMENT_TEXT_CHARS = 4096;

function requireRouter(router) {
  if (!router || typeof router.execute !== 'function') throw new Error('Semantic embedding requires a model router');
  return router;
}
function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}
function positiveInt(value, fallback, max) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? Math.min(number, max) : fallback;
}
function normalizeKinds(kinds) {
  if (kinds == null) return null;
  if (!Array.isArray(kinds)) throw new Error('Semantic embedding kinds must be an array');
  return [...new Set(kinds.map((kind) => requireString(String(kind), 'Semantic embedding kind')))].sort();
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
    projectId: requireString(String(graph?.projectId ?? ''), 'Semantic embedding projectId'),
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
  const values = Array.from(vector, Number);
  if (!values.length || values.length > MAX_SEMANTIC_EMBEDDING_DIMENSIONS) throw new Error(`Embedding vector dimensions must be between 1 and ${MAX_SEMANTIC_EMBEDDING_DIMENSIONS}`);
  if (expectedDimensions != null && values.length !== expectedDimensions) throw new Error(`Embedding vector dimensions ${values.length} do not match expected ${expectedDimensions}`);
  if (values.some((value) => !Number.isFinite(value))) throw new Error('Embedding vector values must be finite');
  return values;
}
function normalizeEmbedOutput(output, expectedCount, expectedDimensions = null) {
  const vectors = output?.vectors;
  if (!Array.isArray(vectors) || vectors.length !== expectedCount) throw new Error(`Embedding backend must return exactly ${expectedCount} vectors`);
  let dimensions = expectedDimensions;
  const normalized = vectors.map((vector) => {
    const clean = validateVector(vector, dimensions);
    dimensions ??= clean.length;
    return clean;
  });
  return {
    vectors: normalized,
    dimensions,
    metadata: output?.metadata && typeof output.metadata === 'object' && !Array.isArray(output.metadata) ? { ...output.metadata } : {},
  };
}
function cosine(a, b) {
  let dot = 0; let aa = 0; let bb = 0;
  for (let index = 0; index < a.length; index += 1) { dot += a[index] * b[index]; aa += a[index] ** 2; bb += b[index] ** 2; }
  if (aa === 0 || bb === 0) return 0;
  return dot / Math.sqrt(aa * bb);
}

export function semanticEmbeddingSourceFingerprint(graph, { kinds = null } = {}) {
  const normalizedKinds = normalizeKinds(kinds);
  return embeddingSource(graph, normalizedKinds).sourceFingerprint;
}

export function semanticEmbeddingCacheKey({ projectId, sourceFingerprint, backendId, kinds = null } = {}) {
  const payload = {
    schema: SEMANTIC_EMBEDDING_CACHE_SCHEMA,
    projectId: requireString(projectId, 'Semantic embedding cache projectId'),
    sourceFingerprint: requireString(sourceFingerprint, 'Semantic embedding cache source fingerprint'),
    backendId: requireString(backendId, 'Semantic embedding cache backend id'),
    kinds: normalizeKinds(kinds),
  };
  return `semantic-embedding:${operationLogChecksum(payload)}`;
}

export function assertSemanticEmbeddingIndex(index, { projectId = null, sourceFingerprint = null, backendId = null } = {}) {
  if (!index || typeof index !== 'object' || Array.isArray(index) || index.schema !== SEMANTIC_EMBEDDING_INDEX_SCHEMA) throw new Error('A valid semantic embedding index is required');
  requireString(index.projectId, 'Semantic embedding index projectId');
  requireString(index.sourceFingerprint, 'Semantic embedding index source fingerprint');
  if (index.backendId != null) requireString(index.backendId, 'Semantic embedding index backend id');
  if (projectId != null && index.projectId !== projectId) throw new Error('Semantic embedding index projectId does not match expected project');
  if (sourceFingerprint != null && index.sourceFingerprint !== sourceFingerprint) throw new Error('Semantic embedding index source fingerprint does not match expected source');
  if (backendId != null && index.backendId !== backendId) throw new Error('Semantic embedding index backend id does not match expected backend');
  if (!Number.isSafeInteger(index.dimensions) || index.dimensions < 0 || index.dimensions > MAX_SEMANTIC_EMBEDDING_DIMENSIONS) throw new Error('Semantic embedding index dimensions are invalid');
  if (!Array.isArray(index.documents) || index.documents.length > MAX_SEMANTIC_EMBEDDING_DOCUMENTS) throw new Error('Semantic embedding index documents are invalid');
  if (index.documents.length && (!index.dimensions || !index.backendId)) throw new Error('Semantic embedding index with documents requires dimensions and backend id');
  if (index.documents.length * index.dimensions > MAX_SEMANTIC_EMBEDDING_SCALARS) throw new Error(`Semantic embedding index exceeds ${MAX_SEMANTIC_EMBEDDING_SCALARS} scalar values`);
  const ids = new Set();
  for (const document of index.documents) {
    if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('Semantic embedding document must be an object');
    const id = requireString(document.id, 'Semantic embedding document id');
    if (ids.has(id)) throw new Error(`Semantic embedding document id is duplicated: ${id}`);
    ids.add(id);
    requireString(document.kind, 'Semantic embedding document kind');
    if (typeof document.name !== 'string') throw new Error('Semantic embedding document name must be a string');
    validateVector(document.vector, index.dimensions);
  }
  if (index.routing !== undefined) {
    if (!Array.isArray(index.routing)) throw new Error('Semantic embedding routing must be an array');
    let routedDocuments = 0;
    for (const route of index.routing) {
      const routeBackendId = requireString(route?.backendId, 'Semantic embedding routing backend id');
      if (index.backendId && routeBackendId !== index.backendId) throw new Error('Semantic embedding routing backend does not match index backend');
      if (!Number.isSafeInteger(route?.count) || route.count < 1) throw new Error('Semantic embedding routing count must be a positive safe integer');
      routedDocuments += route.count;
    }
    if (routedDocuments !== index.documents.length) throw new Error('Semantic embedding routing counts do not match index documents');
  }
  return index;
}

export async function createSemanticEmbeddingIndex(graph, router, {
  policy = {},
  kinds = null,
  maxDocuments = 1024,
  maxScalars = MAX_SEMANTIC_EMBEDDING_SCALARS,
  batchSize = DEFAULT_BATCH_SIZE,
  signal,
} = {}) {
  requireRouter(router);
  const normalizedKinds = normalizeKinds(kinds);
  const documentLimit = positiveInt(maxDocuments, 1024, MAX_SEMANTIC_EMBEDDING_DOCUMENTS);
  const scalarLimit = positiveInt(maxScalars, MAX_SEMANTIC_EMBEDDING_SCALARS, MAX_SEMANTIC_EMBEDDING_SCALARS);
  const size = positiveInt(batchSize, DEFAULT_BATCH_SIZE, 256);
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

export function searchSemanticEmbeddingIndex(index, queryVector, { limit = 20, kinds = null, minimumScore = -1 } = {}) {
  assertSemanticEmbeddingIndex(index);
  if (!index.dimensions) return [];
  const query = validateVector(queryVector, index.dimensions);
  const allowed = kinds == null ? null : new Set(kinds.map(String));
  const maxResults = positiveInt(limit, 20, 200);
  const threshold = Number.isFinite(Number(minimumScore)) ? Number(minimumScore) : -1;
  return index.documents
    .filter((document) => !allowed || allowed.has(document.kind))
    .map((document) => ({ id: document.id, kind: document.kind, name: document.name, score: cosine(query, validateVector(document.vector, index.dimensions)) }))
    .filter((result) => result.score >= threshold)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .slice(0, maxResults);
}

export async function embedSemanticQuery(router, index, query, { policy = {}, signal, limit = 20, kinds = null, minimumScore = -1 } = {}) {
  requireRouter(router);
  assertSemanticEmbeddingIndex(index);
  if (typeof query !== 'string' || !query.trim()) return [];
  const cleanPolicy = normalizeModelRoutingPolicy(policy);
  const callerAllowed = cleanPolicy.allowedBackendIds == null ? null : new Set(cleanPolicy.allowedBackendIds);
  const queryPolicy = index.backendId
    ? { ...cleanPolicy, allowedBackendIds: callerAllowed == null || callerAllowed.has(index.backendId) ? [index.backendId] : [] }
    : cleanPolicy;
  const routed = await router.execute('embed', { texts: [query.trim().slice(0, MAX_DOCUMENT_TEXT_CHARS)] }, { signal, policy: queryPolicy, context: { purpose: 'semantic-query', projectId: index.projectId } });
  if (index.backendId && routed.backendId !== index.backendId) throw new Error(`Semantic query backend ${routed.backendId} does not match index backend ${index.backendId}`);
  const normalized = normalizeEmbedOutput(routed.output, 1, index.dimensions);
  return searchSemanticEmbeddingIndex(index, normalized.vectors[0], { limit, kinds, minimumScore }).map((result) => ({ ...result, backendId: routed.backendId }));
}

export function searchSemanticHybrid(graph, embeddingIndex, query, queryVector, { limit = 20, kinds = null, lexicalWeight = 1, embeddingWeight = 1 } = {}) {
  const maxResults = positiveInt(limit, 20, 200);
  const lexical = searchSemanticGraph(graph, query, { limit: Math.min(200, maxResults * 4), kinds });
  const embedded = searchSemanticEmbeddingIndex(embeddingIndex, queryVector, { limit: Math.min(200, maxResults * 4), kinds });
  const scores = new Map();
  const metadata = new Map();
  lexical.forEach((result, index) => {
    scores.set(result.id, (scores.get(result.id) ?? 0) + Number(lexicalWeight) / (60 + index + 1));
    metadata.set(result.id, { id: result.id, kind: result.kind, name: result.name });
  });
  embedded.forEach((result, index) => {
    scores.set(result.id, (scores.get(result.id) ?? 0) + Number(embeddingWeight) / (60 + index + 1));
    metadata.set(result.id, { id: result.id, kind: result.kind, name: result.name });
  });
  return [...scores.entries()].map(([id, score]) => ({ ...metadata.get(id), score })).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).slice(0, maxResults);
}
