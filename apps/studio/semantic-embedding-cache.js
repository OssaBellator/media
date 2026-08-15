import {
  SEMANTIC_EMBEDDING_INDEX_SCHEMA,
  assertSemanticEmbeddingIndex,
  createSemanticEmbeddingIndex,
  semanticEmbeddingCacheKey,
  semanticEmbeddingSourceFingerprint,
} from '../../packages/core/src/semantic-embedding.js';
import { deleteDerivedArtifact, listDerivedArtifacts, loadDerivedArtifact, saveDerivedArtifact } from './storage.js';

const SEMANTIC_EMBEDDING_PREFIX = 'semantic-embedding:';

function requireFunction(value, label) {
  if (typeof value !== 'function') throw new Error(`${label} must be a function`);
  return value;
}

function normalizeKinds(kinds) {
  if (kinds == null) return null;
  if (!Array.isArray(kinds)) throw new Error('Semantic embedding cache kinds must be an array');
  const normalized = [...new Set(kinds.map((kind) => String(kind).trim()))].sort();
  if (normalized.some((kind) => !kind)) throw new Error('Semantic embedding cache kinds must be non-empty strings');
  return normalized;
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

export class SemanticEmbeddingCache {
  constructor({ router, load = loadDerivedArtifact, save = saveDerivedArtifact, remove = deleteDerivedArtifact, list = listDerivedArtifacts } = {}) {
    if (!router || typeof router.execute !== 'function' || typeof router.list !== 'function') throw new Error('Semantic embedding cache requires a model router');
    this.router = router;
    this.load = requireFunction(load, 'Semantic embedding cache load');
    this.save = requireFunction(save, 'Semantic embedding cache save');
    this.remove = requireFunction(remove, 'Semantic embedding cache remove');
    this.list = requireFunction(list, 'Semantic embedding cache list');
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

  async getOrCreate(graph, { kinds = null, policy = {}, signal, ...indexOptions } = {}) {
    const normalizedKinds = normalizeKinds(kinds);
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
    const index = await createSemanticEmbeddingIndex(graph, this.router, { kinds: normalizedKinds, policy, signal, ...indexOptions });
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

  async invalidate(graph, { kinds = null, policy = {} } = {}) {
    const normalizedKinds = normalizeKinds(kinds);
    const sourceFingerprint = semanticEmbeddingSourceFingerprint(graph, { kinds: normalizedKinds });
    let removed = 0;
    for (const backend of this.router.list('embed', policy)) {
      const key = semanticEmbeddingCacheKey({ projectId: graph.projectId, sourceFingerprint, backendId: backend.id, kinds: normalizedKinds });
      try { if (await this.remove(key) !== false) removed += 1; } catch {}
    }
    return removed;
  }

  async pruneStale(graph, { kinds = null } = {}) {
    const normalizedKinds = normalizeKinds(kinds);
    const sourceFingerprint = semanticEmbeddingSourceFingerprint(graph, { kinds: normalizedKinds });
    const records = await this.list({ prefix: SEMANTIC_EMBEDDING_PREFIX });
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
