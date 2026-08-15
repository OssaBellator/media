import { createPlannerSnapshot } from './providers.js';
import { createSemanticIndex, searchSemanticGraph } from './semantic-search.js';

export const SEMANTIC_EMBEDDING_INDEX_SCHEMA = 'media.semantic-embedding-index.v1';
export const MAX_SEMANTIC_EMBEDDING_DIMENSIONS = 4096;
export const MAX_SEMANTIC_EMBEDDING_DOCUMENTS = 4096;
export const MAX_SEMANTIC_EMBEDDING_SCALARS = 2_000_000;
const DEFAULT_BATCH_SIZE = 32;
const MAX_DOCUMENT_TEXT_CHARS = 4096;

function requireRouter(router) {
  if (!router || typeof router.execute !== 'function') throw new Error('Semantic embedding requires a model router');
  return router;
}
function positiveInt(value, fallback, max) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? Math.min(number, max) : fallback;
}
function embeddingText(document) {
  const terms = Object.keys(document.terms ?? {}).slice(0, 256).join(' ');
  return `${document.name}\n${document.kind}\n${terms}`.slice(0, MAX_DOCUMENT_TEXT_CHARS);
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
  return { vectors: normalized, dimensions, metadata: output?.metadata && typeof output.metadata === 'object' && !Array.isArray(output.metadata) ? { ...output.metadata } : {} };
}
function cosine(a, b) {
  let dot = 0; let aa = 0; let bb = 0;
  for (let index = 0; index < a.length; index += 1) { dot += a[index] * b[index]; aa += a[index] ** 2; bb += b[index] ** 2; }
  if (aa === 0 || bb === 0) return 0;
  return dot / Math.sqrt(aa * bb);
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
  const documentLimit = positiveInt(maxDocuments, 1024, MAX_SEMANTIC_EMBEDDING_DOCUMENTS);
  const scalarLimit = positiveInt(maxScalars, MAX_SEMANTIC_EMBEDDING_SCALARS, MAX_SEMANTIC_EMBEDDING_SCALARS);
  const size = positiveInt(batchSize, DEFAULT_BATCH_SIZE, 256);
  const safeGraph = createPlannerSnapshot(graph);
  const lexical = createSemanticIndex(safeGraph, { kinds });
  const sourceDocuments = lexical.documents.slice(0, documentLimit);
  const documents = [];
  const routing = [];
  let dimensions = null;
  let scalars = 0;
  for (let start = 0; start < sourceDocuments.length; start += size) {
    const batch = sourceDocuments.slice(start, start + size);
    const texts = batch.map(embeddingText);
    const routed = await router.execute('embed', { texts }, { signal, policy, context: { purpose: 'semantic-index', projectId: graph.projectId } });
    const normalized = normalizeEmbedOutput(routed.output, batch.length, dimensions);
    dimensions ??= normalized.dimensions;
    scalars += batch.length * dimensions;
    if (scalars > scalarLimit) throw new Error(`Semantic embedding index exceeds ${scalarLimit} scalar values`);
    for (let index = 0; index < batch.length; index += 1) documents.push({ id: batch[index].id, kind: batch[index].kind, name: batch[index].name, vector: normalized.vectors[index] });
    routing.push({ backendId: routed.backendId, count: batch.length });
  }
  return { schema: SEMANTIC_EMBEDDING_INDEX_SCHEMA, projectId: graph.projectId, dimensions: dimensions ?? 0, documents, routing };
}

export function searchSemanticEmbeddingIndex(index, queryVector, { limit = 20, kinds = null, minimumScore = -1 } = {}) {
  if (!index || index.schema !== SEMANTIC_EMBEDDING_INDEX_SCHEMA || !Array.isArray(index.documents)) throw new Error('A valid semantic embedding index is required');
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
  if (!index || index.schema !== SEMANTIC_EMBEDDING_INDEX_SCHEMA) throw new Error('A valid semantic embedding index is required');
  if (typeof query !== 'string' || !query.trim()) return [];
  const routed = await router.execute('embed', { texts: [query.trim().slice(0, MAX_DOCUMENT_TEXT_CHARS)] }, { signal, policy, context: { purpose: 'semantic-query', projectId: index.projectId } });
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
