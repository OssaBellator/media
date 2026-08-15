import {
  SEMANTIC_EMBEDDING_INDEX_SCHEMA,
  assertSemanticEmbeddingIndex,
  createSemanticEmbeddingIndex,
  semanticEmbeddingCacheKey,
  semanticEmbeddingSourceFingerprint,
} from '../../packages/core/src/semantic-embedding.js';
import { normalizeModelRoutingPolicy } from '../../packages/core/src/model-router.js';
import { MAX_SEMANTIC_KIND_CHARS, MAX_SEMANTIC_KIND_FILTERS } from '../../packages/core/src/semantic-search.js';
import { deleteDerivedArtifact, listDerivedArtifacts, loadDerivedArtifact, saveDerivedArtifact } from './storage.js';

const SEMANTIC_EMBEDDING_PREFIX = 'semantic-embedding:';
const MAX_PRUNE_RECORDS = 4096;
const CACHE_CONFIG_KEYS = new Set(['router', 'load', 'save', 'remove', 'list']);
const GET_OR_CREATE_KEYS = new Set(['kinds', 'policy', 'signal', 'maxDocuments', 'maxScalars', 'batchSize']);
const INVALIDATE_KEYS = new Set(['kinds', 'policy']);
const PRUNE_KEYS = new Set(['kinds']);

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
function dataMethod(value, name, label) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) throw new Error(`${label} must be an object`);
  let owner = value;
  while (owner) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, name);
    if (descriptor) {
      if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') throw new Error(`${label} ${name} must be a data method`);
      return descriptor.value.bind(value);
    }
    owner = Object.getPrototypeOf(owner);
  }
  throw new Error(`${label} ${name} must be a function`);
}
function normalizeRouter(router) {
  return Object.freeze({
    execute: dataMethod(router, 'execute', 'Semantic embedding cache router'),
    list: dataMethod(router, 'list', 'Semantic embedding cache router'),
  });
}
function requireFunction(value, label) {
  if (typeof value !== 'function') throw new Error(`${label} must be a function`);
  return value;
}

function normalizeKinds(kinds) {
  if (kinds == null) return null;
  if (!Array.isArray(kinds) || kinds.length > MAX_SEMANTIC_KIND_FILTERS) throw new Error(`Semantic embedding cache kinds must be an array with at most ${MAX_SEMANTIC_KIND_FILTERS} entries`);
  const normalized = [];
  for (let index = 0; index < kinds.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(kinds, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('Semantic embedding cache kinds must contain enumerable data values only');
    const kind = descriptor.value;
    if (typeof kind !== 'string' || !kind.trim()) throw new Error('Semantic embedding cache kinds must be non-empty strings');
    const clean = kind.trim();
    if (clean.length > MAX_SEMANTIC_KIND_CHARS) throw new Error(`Semantic embedding cache kind exceeds ${MAX_SEMANTIC_KIND_CHARS} characters`);
    normalized.push(clean);
  }
  return [...new Set(normalized)].sort();
}

function sameKinds(left, right) {
  try {
    return JSON.stringify(normalizeKinds(left)) === JSON.stringify(normalizeKinds(right));
  } catch {
    return false;
  }
}

function storedArtifactValue(stored) {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return stored;
  if (!Object.hasOwn(stored, 'value')) return stored;
  const descriptor = Object.getOwnPropertyDescriptor(stored, 'value');
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('Semantic embedding cache record value must be an enumerable data property');
  return descriptor.value;
}
function pruneRecords(records) {
  if (!Array.isArray(records) || records.length > MAX_PRUNE_RECORDS) throw new Error(`Semantic embedding cache list must return at most ${MAX_PRUNE_RECORDS} records`);
  const output = [];
  for (let index = 0; index < records.length; index += 1) {
    const itemDescriptor = Object.getOwnPropertyDescriptor(records, String(index));
    if (!itemDescriptor?.enumerable || !Object.hasOwn(itemDescriptor, 'value')) throw new Error('Semantic embedding cache list must contain enumerable data records');
    const record = itemDescriptor.value;
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Semantic embedding cache record must be an object');
    const keyDescriptor = Object.getOwnPropertyDescriptor(record, 'key');
    const metadataDescriptor = Object.getOwnPropertyDescriptor(record, 'metadata');
    if (!keyDescriptor?.enumerable || !Object.hasOwn(keyDescriptor, 'value') || typeof keyDescriptor.value !== 'string') throw new Error('Semantic embedding cache record key must be an enumerable string data property');
    if (!metadataDescriptor?.enumerable || !Object.hasOwn(metadataDescriptor, 'value') || !metadataDescriptor.value || typeof metadataDescriptor.value !== 'object' || Array.isArray(metadataDescriptor.value)) throw new Error('Semantic embedding cache record metadata must be an enumerable object data property');
    const metadataDescriptors = Object.getOwnPropertyDescriptors(metadataDescriptor.value);
    const metadata = {};
    for (const key of ['schema', 'projectId', 'sourceFingerprint', 'kinds']) {
      const descriptor = metadataDescriptors[key];
      if (descriptor === undefined) continue;
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('Semantic embedding cache metadata must contain data properties only');
      metadata[key] = descriptor.value;
    }
    output.push({ key: keyDescriptor.value, metadata });
  }
  return output;
}

export class SemanticEmbeddingCache {
  constructor(options = {}) {
    const config = dataOptions(options, 'Semantic embedding cache constructor options', CACHE_CONFIG_KEYS);
    if (!config.router) throw new Error('Semantic embedding cache requires a model router');
    this.router = normalizeRouter(config.router);
    this.load = requireFunction(config.load ?? loadDerivedArtifact, 'Semantic embedding cache load');
    this.save = requireFunction(config.save ?? saveDerivedArtifact, 'Semantic embedding cache save');
    this.remove = requireFunction(config.remove ?? deleteDerivedArtifact, 'Semantic embedding cache remove');
    this.list = requireFunction(config.list ?? listDerivedArtifacts, 'Semantic embedding cache list');
    this.prunedScopes = new Set();
  }

  async #pruneCurrentOnce(graph, normalizedKinds, sourceFingerprint) {
    const scopeKey = JSON.stringify([graph.projectId, sourceFingerprint, normalizedKinds]);
    if (this.prunedScopes.has(scopeKey)) return { cachePrune: null, cachePruneError: null };
    this.prunedScopes.add(scopeKey);
    try {
      return { cachePrune: await this.pruneStale(graph, { kinds: normalizedKinds }), cachePruneError: null };
    } catch (error) {
      return { cachePrune: null, cachePruneError: error };
    }
  }

  async getOrCreate(graph, options = {}) {
    const config = dataOptions(options, 'Semantic embedding cache getOrCreate options', GET_OR_CREATE_KEYS);
    const normalizedKinds = normalizeKinds(config.kinds ?? null);
    const policy = normalizeModelRoutingPolicy(config.policy ?? {});
    const signal = config.signal;
    const sourceFingerprint = semanticEmbeddingSourceFingerprint(graph, { kinds: normalizedKinds });
    let cacheReadError = null;
    let cacheWriteError = null;
    for (const backend of this.router.list('embed', policy)) {
      const key = semanticEmbeddingCacheKey({ projectId: graph.projectId, sourceFingerprint, backendId: backend.id, kinds: normalizedKinds });
      let stored;
      try { stored = await this.load(key); }
      catch (error) { cacheReadError ??= error; break; }
      if (!stored) continue;
      try {
        const value = storedArtifactValue(stored);
        const index = assertSemanticEmbeddingIndex(value, { projectId: graph.projectId, sourceFingerprint, backendId: backend.id });
        const pruning = await this.#pruneCurrentOnce(graph, normalizedKinds, sourceFingerprint);
        return { index, key, cached: true, cacheReadError: null, cacheWriteError: null, ...pruning };
      } catch {
        try { await this.remove(key); } catch {}
      }
    }
    const index = await createSemanticEmbeddingIndex(graph, this.router, {
      kinds: normalizedKinds,
      policy,
      signal,
      maxDocuments: config.maxDocuments,
      maxScalars: config.maxScalars,
      batchSize: config.batchSize,
    });
    const key = semanticEmbeddingCacheKey({ projectId: graph.projectId, sourceFingerprint: index.sourceFingerprint, backendId: index.backendId, kinds: normalizedKinds });
    try {
      await this.save(key, index, {
        schema: index.schema,
        projectId: index.projectId,
        sourceFingerprint: index.sourceFingerprint,
        backendId: index.backendId,
        dimensions: index.dimensions,
        documents: index.documents.length,
        kinds: normalizedKinds,
      });
    } catch (error) { cacheWriteError = error; }
    const pruning = await this.#pruneCurrentOnce(graph, normalizedKinds, index.sourceFingerprint);
    return { index, key, cached: false, cacheReadError, cacheWriteError, ...pruning };
  }

  async invalidate(graph, options = {}) {
    const config = dataOptions(options, 'Semantic embedding cache invalidate options', INVALIDATE_KEYS);
    const normalizedKinds = normalizeKinds(config.kinds ?? null);
    const policy = normalizeModelRoutingPolicy(config.policy ?? {});
    const sourceFingerprint = semanticEmbeddingSourceFingerprint(graph, { kinds: normalizedKinds });
    let removed = 0;
    for (const backend of this.router.list('embed', policy)) {
      const key = semanticEmbeddingCacheKey({ projectId: graph.projectId, sourceFingerprint, backendId: backend.id, kinds: normalizedKinds });
      try { if (await this.remove(key) !== false) removed += 1; } catch {}
    }
    return removed;
  }

  async pruneStale(graph, options = {}) {
    const config = dataOptions(options, 'Semantic embedding cache prune options', PRUNE_KEYS);
    const normalizedKinds = normalizeKinds(config.kinds ?? null);
    const sourceFingerprint = semanticEmbeddingSourceFingerprint(graph, { kinds: normalizedKinds });
    const records = pruneRecords(await this.list({ prefix: SEMANTIC_EMBEDDING_PREFIX, limit: MAX_PRUNE_RECORDS }));
    let removed = 0;
    let retained = 0;
    let failed = 0;
    for (const record of records ?? []) {
      const metadata = record?.metadata ?? {};
      if (metadata.schema !== SEMANTIC_EMBEDDING_INDEX_SCHEMA || metadata.projectId !== graph.projectId || !sameKinds(metadata.kinds ?? null, normalizedKinds)) continue;
      if (metadata.sourceFingerprint === sourceFingerprint) { retained += 1; continue; }
      try {
        if (await this.remove(record.key) !== false) removed += 1;
        else failed += 1;
      } catch { failed += 1; }
    }
    return { removed, retained, failed, sourceFingerprint, kinds: normalizedKinds };
  }
}
