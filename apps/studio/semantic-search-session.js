import {
  MAX_SEMANTIC_KIND_CHARS,
  MAX_SEMANTIC_KIND_FILTERS,
  MAX_SEMANTIC_QUERY_CHARS,
  MAX_SEMANTIC_SEARCH_RESULTS,
  searchSemanticGraph,
} from '../../packages/core/src/semantic-search.js';
import {
  MAX_SEMANTIC_EMBEDDING_DIMENSIONS,
  MAX_SEMANTIC_EMBEDDING_DOCUMENTS,
  MAX_SEMANTIC_EMBEDDING_SCALARS,
  embedSemanticQuery,
  semanticEmbeddingSourceFingerprint,
} from '../../packages/core/src/semantic-embedding.js';
import { normalizeBoundedModelInput } from '../../packages/core/src/model-input.js';
import { normalizeModelRoutingPolicy } from '../../packages/core/src/model-router.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = MAX_SEMANTIC_SEARCH_RESULTS;
const RRF_OFFSET = 60;
const MAX_RESULT_BYTES = 256 * 1024;
const MAX_RESULT_ENTRIES = 4096;
const MAX_RESULT_ID_CHARS = 1024;
const MAX_RESULT_NAME_CHARS = 4096;
const MAX_RESULT_KIND_CHARS = 128;
const MAX_ERROR_CHARS = 1024;
const MAX_EMBEDDING_BATCH_SIZE = 256;
const SESSION_OPTION_KEYS = new Set(['getGraph', 'router', 'embeddingCache', 'onUpdate', 'lexicalSearch', 'embedQuery', 'sourceFingerprint']);
const SEARCH_OPTION_KEYS = new Set(['limit', 'kinds', 'policy', 'signal', 'useEmbeddings', 'embeddingLimit', 'maxDocuments', 'maxScalars', 'batchSize']);
const LEXICAL_OPTION_KEYS = new Set(['limit', 'kinds']);

function requireFunction(value, label) {
  if (typeof value !== 'function') throw new Error(`${label} must be a function`);
  return value;
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
    clean[key] = descriptor.value;
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
function ownData(value, key, label) {
  if (!value || typeof value !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return undefined;
  if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error(`${label} ${key} must be an enumerable data property`);
  return descriptor.value;
}
function inheritedData(value, key) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
  let owner = value;
  while (owner) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (descriptor) return Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
    owner = Object.getPrototypeOf(owner);
  }
  return undefined;
}
function boundedLimit(value, label = 'Studio semantic search limit') {
  if (value === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) throw new Error(`${label} must be an integer between 1 and ${MAX_LIMIT}`);
  return value;
}
function boundedEmbeddingOption(value, label, max) {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`${label} must be an integer between 1 and ${max}`);
  return value;
}
function normalizeKinds(kinds) {
  if (kinds == null) return null;
  if (!Array.isArray(kinds) || kinds.length > MAX_SEMANTIC_KIND_FILTERS) throw new Error(`Studio semantic search kinds must be an array with at most ${MAX_SEMANTIC_KIND_FILTERS} entries`);
  const normalized = [];
  for (let index = 0; index < kinds.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(kinds, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('Studio semantic search kinds must contain enumerable data values only');
    const kind = descriptor.value;
    if (typeof kind !== 'string' || !kind.trim()) throw new Error('Studio semantic search kind must be a non-empty string');
    const clean = kind.trim();
    if (clean.length > MAX_SEMANTIC_KIND_CHARS) throw new Error(`Studio semantic search kind exceeds ${MAX_SEMANTIC_KIND_CHARS} characters`);
    normalized.push(clean);
  }
  return [...new Set(normalized)].sort();
}
function normalizeQuery(query) {
  if (typeof query !== 'string') throw new Error('Studio semantic search query must be a string');
  if (query.length > MAX_SEMANTIC_QUERY_CHARS) throw new Error(`Studio semantic search query exceeds ${MAX_SEMANTIC_QUERY_CHARS} characters`);
  return query.trim();
}
function normalizeSignal(signal) {
  if (signal == null) return null;
  const AbortSignalCtor = globalThis.AbortSignal;
  if (typeof AbortSignalCtor !== 'function' || !(signal instanceof AbortSignalCtor)) throw new Error('Studio semantic search signal must be an AbortSignal');
  return signal;
}
function cleanError(error) {
  if (error == null) return null;
  if (typeof error === 'string') return { name: 'Error', code: null, message: error.slice(0, MAX_ERROR_CHARS) };
  if (typeof error !== 'object' && typeof error !== 'function') return { name: 'Error', code: null, message: 'Semantic search failed' };
  const name = inheritedData(error, 'name');
  const code = inheritedData(error, 'code');
  const message = inheritedData(error, 'message');
  return {
    name: typeof name === 'string' && name ? name.slice(0, 128) : 'Error',
    code: typeof code === 'string' ? code.slice(0, 128) : (Number.isSafeInteger(code) ? String(code) : null),
    message: typeof message === 'string' && message ? message.slice(0, MAX_ERROR_CHARS) : 'Semantic search failed',
  };
}
function boundedCount(value, label) {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) throw new Error(`${label} must be a non-negative safe integer`);
  return value;
}
function cacheSnapshot(result) {
  if (result == null) return null;
  if (typeof result !== 'object' || Array.isArray(result)) throw new Error('Semantic embedding cache result must be an object');
  const cached = ownData(result, 'cached', 'Semantic embedding cache result');
  const key = ownData(result, 'key', 'Semantic embedding cache result');
  if (cached !== undefined && typeof cached !== 'boolean') throw new Error('Semantic embedding cache result cached must be a boolean');
  if (key !== undefined && key !== null && typeof key !== 'string') throw new Error('Semantic embedding cache result key must be a string');
  const prune = ownData(result, 'cachePrune', 'Semantic embedding cache result');
  if (prune != null && (typeof prune !== 'object' || Array.isArray(prune))) throw new Error('Semantic embedding cache prune must be an object');
  const cachePrune = prune == null ? null : {
    removed: boundedCount(ownData(prune, 'removed', 'Semantic embedding cache prune'), 'Semantic embedding cache prune removed'),
    retained: boundedCount(ownData(prune, 'retained', 'Semantic embedding cache prune'), 'Semantic embedding cache prune retained'),
    failed: boundedCount(ownData(prune, 'failed', 'Semantic embedding cache prune'), 'Semantic embedding cache prune failed'),
  };
  return {
    cached: cached === true,
    key: typeof key === 'string' ? key.slice(0, 1024) : null,
    cacheReadError: cleanError(ownData(result, 'cacheReadError', 'Semantic embedding cache result')),
    cacheWriteError: cleanError(ownData(result, 'cacheWriteError', 'Semantic embedding cache result')),
    cachePrune,
    cachePruneError: cleanError(ownData(result, 'cachePruneError', 'Semantic embedding cache result')),
  };
}
function normalizeResult(result, label) {
  const safe = normalizeBoundedModelInput(result, label, { maxBytes: MAX_RESULT_BYTES, maxEntries: MAX_RESULT_ENTRIES, maxDepth: 6, allowBinary: false });
  if (!safe || typeof safe !== 'object' || Array.isArray(safe)) throw new Error(`${label} must be an object`);
  if (typeof safe.id !== 'string' || !safe.id || safe.id.length > MAX_RESULT_ID_CHARS) throw new Error(`${label} id must be a bounded non-empty string`);
  if (typeof safe.kind !== 'string' || !safe.kind || safe.kind.length > MAX_RESULT_KIND_CHARS) throw new Error(`${label} kind must be a bounded non-empty string`);
  if (typeof safe.name !== 'string' || safe.name.length > MAX_RESULT_NAME_CHARS) throw new Error(`${label} name must be a bounded string`);
  if (typeof safe.score !== 'number' || !Number.isFinite(safe.score)) throw new Error(`${label} score must be a finite number`);
  const normalized = { id: safe.id, kind: safe.kind, name: safe.name, score: safe.score };
  if (safe.backendId !== undefined) {
    if (typeof safe.backendId !== 'string' || !safe.backendId || safe.backendId.length > 160) throw new Error(`${label} backendId must be a bounded non-empty string`);
    normalized.backendId = safe.backendId;
  }
  if (safe.matchedTerms !== undefined) {
    if (!Array.isArray(safe.matchedTerms) || safe.matchedTerms.length > 128 || safe.matchedTerms.some((term) => typeof term !== 'string' || term.length > 256)) throw new Error(`${label} matchedTerms must be a bounded string array`);
    normalized.matchedTerms = [...safe.matchedTerms];
  }
  if (safe.sources !== undefined) {
    if (!safe.sources || typeof safe.sources !== 'object' || Array.isArray(safe.sources)) throw new Error(`${label} sources must be an object`);
    const entries = Object.entries(safe.sources);
    if (entries.length > 128) throw new Error(`${label} sources exceed 128 terms`);
    normalized.sources = Object.create(null);
    for (const [term, values] of entries) {
      if (term.length > 256 || !Array.isArray(values) || values.length > 64 || values.some((source) => typeof source !== 'string' || source.length > 256)) throw new Error(`${label} sources must contain bounded string arrays`);
      Object.defineProperty(normalized.sources, term, { value: [...values], enumerable: true, writable: true, configurable: true });
    }
  }
  return normalized;
}
function normalizeResultList(results, label) {
  if (!Array.isArray(results) || results.length > MAX_LIMIT) throw new Error(`${label} must be an array with at most ${MAX_LIMIT} results`);
  const normalized = [];
  for (let index = 0; index < results.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(results, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error(`${label} must contain enumerable data results only`);
    normalized.push(normalizeResult(descriptor.value, `${label}[${index}]`));
  }
  return normalized;
}
function cloneResult(result) {
  return {
    id: result.id,
    kind: result.kind,
    name: result.name,
    score: result.score,
    ...(result.backendId ? { backendId: result.backendId } : {}),
    ...(result.matchedTerms ? { matchedTerms: [...result.matchedTerms] } : {}),
    ...(result.sources ? { sources: Object.fromEntries(Object.entries(result.sources).map(([term, values]) => [term, [...values]])) } : {}),
  };
}
function snapshotState(state) {
  return {
    ...state,
    results: state.results.map(cloneResult),
    lexical: state.lexical.map(cloneResult),
    embedded: state.embedded.map(cloneResult),
    cache: state.cache ? {
      ...state.cache,
      cacheReadError: state.cache.cacheReadError ? { ...state.cache.cacheReadError } : null,
      cacheWriteError: state.cache.cacheWriteError ? { ...state.cache.cacheWriteError } : null,
      cachePrune: state.cache.cachePrune ? { ...state.cache.cachePrune } : null,
      cachePruneError: state.cache.cachePruneError ? { ...state.cache.cachePruneError } : null,
    } : null,
    error: state.error ? { ...state.error } : null,
  };
}
function embeddingIndexInfo(cached) {
  const index = ownData(cached, 'index', 'Semantic embedding cache result');
  if (index == null) return { index: null, dimensions: 0, documentCount: 0, sourceFingerprint: null };
  if (typeof index !== 'object' || Array.isArray(index)) throw new Error('Semantic embedding cache index must be an object');
  const dimensions = ownData(index, 'dimensions', 'Semantic embedding cache index');
  const documents = ownData(index, 'documents', 'Semantic embedding cache index');
  const sourceFingerprint = ownData(index, 'sourceFingerprint', 'Semantic embedding cache index');
  if (!Number.isSafeInteger(dimensions) || dimensions < 0 || dimensions > MAX_SEMANTIC_EMBEDDING_DIMENSIONS) throw new Error('Semantic embedding cache index dimensions are invalid');
  if (!Array.isArray(documents) || documents.length > MAX_SEMANTIC_EMBEDDING_DOCUMENTS) throw new Error('Semantic embedding cache index documents must be a bounded array');
  if (documents.length * dimensions > MAX_SEMANTIC_EMBEDDING_SCALARS) throw new Error('Semantic embedding cache index exceeds the scalar budget');
  if (typeof sourceFingerprint !== 'string' || !sourceFingerprint || sourceFingerprint.length > 1024) throw new Error('Semantic embedding cache index sourceFingerprint must be a bounded non-empty string');
  return { index, dimensions, documentCount: documents.length, sourceFingerprint };
}
function fingerprintValue(value) {
  if (typeof value !== 'string' || !value || value.length > 1024) throw new Error('Studio semantic source fingerprint must be a bounded non-empty string');
  return value;
}
function rankHybrid(lexical, embedded, limit) {
  const scores = new Map();
  const metadata = new Map();
  lexical.forEach((result, index) => {
    scores.set(result.id, (scores.get(result.id) ?? 0) + 1 / (RRF_OFFSET + index + 1));
    metadata.set(result.id, result);
  });
  embedded.forEach((result, index) => {
    scores.set(result.id, (scores.get(result.id) ?? 0) + 1 / (RRF_OFFSET + index + 1));
    if (!metadata.has(result.id)) metadata.set(result.id, result);
  });
  return [...scores.entries()]
    .map(([id, score]) => ({ ...metadata.get(id), score }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

export class StudioSemanticSearchSession {
  constructor(options = {}) {
    const config = dataOptions(options, 'Studio semantic search constructor options', SESSION_OPTION_KEYS);
    const router = config.router ?? null;
    const embeddingCache = config.embeddingCache ?? null;
    const onUpdate = config.onUpdate ?? null;
    this.getGraph = requireFunction(config.getGraph, 'Studio semantic search getGraph');
    if (router != null) dataMethod(router, 'execute', 'Studio semantic search router');
    this.getOrCreateEmbeddingIndex = embeddingCache == null ? null : dataMethod(embeddingCache, 'getOrCreate', 'Studio semantic search embedding cache');
    if (onUpdate != null && typeof onUpdate !== 'function') throw new Error('Studio semantic search onUpdate must be a function');
    this.lexicalSearch = requireFunction(config.lexicalSearch ?? searchSemanticGraph, 'Studio semantic lexicalSearch');
    this.embedQuery = requireFunction(config.embedQuery ?? embedSemanticQuery, 'Studio semantic embedQuery');
    this.sourceFingerprint = requireFunction(config.sourceFingerprint ?? semanticEmbeddingSourceFingerprint, 'Studio semantic sourceFingerprint');
    this.router = router;
    this.onUpdate = onUpdate;
    this.requestId = 0;
    this.state = {
      status: 'idle',
      mode: 'lexical',
      query: '',
      results: [],
      lexical: [],
      embedded: [],
      cache: null,
      error: null,
      superseded: false,
    };
  }

  snapshot() {
    return snapshotState(this.state);
  }

  #publish(state) {
    this.state = state;
    const snapshot = this.snapshot();
    try { this.onUpdate?.(snapshot); } catch {}
    return snapshot;
  }

  searchLexical(query, options = {}) {
    const config = dataOptions(options, 'Studio semantic lexical search options', LEXICAL_OPTION_KEYS);
    this.requestId += 1;
    const cleanQuery = normalizeQuery(query);
    const maxResults = boundedLimit(config.limit);
    const kinds = normalizeKinds(config.kinds ?? null);
    const lexical = cleanQuery ? normalizeResultList(this.lexicalSearch(this.getGraph(), cleanQuery, { limit: maxResults, kinds }), 'Studio lexical search results') : [];
    return this.#publish({
      status: 'ready',
      mode: 'lexical',
      query: cleanQuery,
      results: lexical,
      lexical,
      embedded: [],
      cache: null,
      error: null,
      superseded: false,
    });
  }

  async search(query, options = {}) {
    const config = dataOptions(options, 'Studio semantic search options', SEARCH_OPTION_KEYS);
    const cleanQuery = normalizeQuery(query);
    const maxResults = boundedLimit(config.limit);
    const kinds = normalizeKinds(config.kinds ?? null);
    const policy = normalizeModelRoutingPolicy(config.policy ?? {});
    const signal = normalizeSignal(config.signal);
    const useEmbeddings = config.useEmbeddings ?? true;
    if (typeof useEmbeddings !== 'boolean') throw new Error('Studio semantic search useEmbeddings must be a boolean');
    const embeddingLimit = config.embeddingLimit == null ? Math.min(MAX_LIMIT, maxResults * 4) : boundedLimit(config.embeddingLimit, 'Studio semantic embedding limit');
    const indexOptions = {};
    const maxDocuments = boundedEmbeddingOption(config.maxDocuments, 'Studio semantic embedding maxDocuments', MAX_SEMANTIC_EMBEDDING_DOCUMENTS);
    const maxScalars = boundedEmbeddingOption(config.maxScalars, 'Studio semantic embedding maxScalars', MAX_SEMANTIC_EMBEDDING_SCALARS);
    const batchSize = boundedEmbeddingOption(config.batchSize, 'Studio semantic embedding batchSize', MAX_EMBEDDING_BATCH_SIZE);
    if (maxDocuments !== undefined) indexOptions.maxDocuments = maxDocuments;
    if (maxScalars !== undefined) indexOptions.maxScalars = maxScalars;
    if (batchSize !== undefined) indexOptions.batchSize = batchSize;
    const requestId = ++this.requestId;
    const graph = this.getGraph();
    const lexical = cleanQuery ? normalizeResultList(this.lexicalSearch(graph, cleanQuery, { limit: maxResults, kinds }), 'Studio lexical search results') : [];
    const canEmbed = Boolean(cleanQuery && useEmbeddings && this.router && this.getOrCreateEmbeddingIndex);
    const lexicalState = {
      status: canEmbed ? 'searching' : 'ready',
      mode: 'lexical',
      query: cleanQuery,
      results: lexical,
      lexical,
      embedded: [],
      cache: null,
      error: null,
      superseded: false,
    };
    this.#publish(lexicalState);
    if (!canEmbed) return this.snapshot();

    try {
      const cached = await this.getOrCreateEmbeddingIndex(graph, { kinds, policy, signal, ...indexOptions });
      const cache = cacheSnapshot(cached);
      const indexInfo = embeddingIndexInfo(cached);
      if (requestId !== this.requestId) return { ...snapshotState(lexicalState), status: 'ready', cache, superseded: true };
      if (!indexInfo.index || !indexInfo.dimensions || !indexInfo.documentCount) {
        return this.#publish({ ...lexicalState, status: 'ready', cache });
      }
      let currentGraph = this.getGraph();
      let currentLexical = currentGraph === graph ? lexical : (cleanQuery ? normalizeResultList(this.lexicalSearch(currentGraph, cleanQuery, { limit: maxResults, kinds }), 'Studio lexical search results') : []);
      let currentSourceFingerprint = fingerprintValue(this.sourceFingerprint(currentGraph, { kinds }));
      if (currentSourceFingerprint !== indexInfo.sourceFingerprint) {
        return this.#publish({
          ...lexicalState,
          status: 'ready',
          mode: 'lexical-fallback',
          results: currentLexical,
          lexical: currentLexical,
          cache,
          error: { name: 'SemanticSearchSourceChanged', code: 'SEMANTIC_SEARCH_SOURCE_CHANGED', message: 'Searchable model-visible graph content changed while semantic ranking was in progress' },
        });
      }
      const embedded = normalizeResultList(await this.embedQuery(this.router, indexInfo.index, cleanQuery, {
        policy,
        signal,
        limit: embeddingLimit,
        kinds,
      }), 'Studio semantic embedding results');
      if (requestId !== this.requestId) return { ...snapshotState(lexicalState), status: 'ready', cache, embedded, superseded: true };
      const latestGraph = this.getGraph();
      if (latestGraph !== currentGraph) {
        currentGraph = latestGraph;
        currentLexical = cleanQuery ? normalizeResultList(this.lexicalSearch(currentGraph, cleanQuery, { limit: maxResults, kinds }), 'Studio lexical search results') : [];
        currentSourceFingerprint = fingerprintValue(this.sourceFingerprint(currentGraph, { kinds }));
        if (currentSourceFingerprint !== indexInfo.sourceFingerprint) {
          return this.#publish({
            ...lexicalState,
            status: 'ready',
            mode: 'lexical-fallback',
            results: currentLexical,
            lexical: currentLexical,
            cache,
            error: { name: 'SemanticSearchSourceChanged', code: 'SEMANTIC_SEARCH_SOURCE_CHANGED', message: 'Searchable model-visible graph content changed while semantic ranking was in progress' },
          });
        }
      }
      return this.#publish({
        ...lexicalState,
        status: 'ready',
        mode: 'hybrid',
        results: rankHybrid(currentLexical, embedded, maxResults),
        lexical: currentLexical,
        embedded,
        cache,
      });
    } catch (error) {
      if (requestId !== this.requestId) return { ...snapshotState(lexicalState), status: 'ready', error: cleanError(error), superseded: true };
      const currentGraph = this.getGraph();
      const refreshed = currentGraph === graph ? lexical : (cleanQuery ? normalizeResultList(this.lexicalSearch(currentGraph, cleanQuery, { limit: maxResults, kinds }), 'Studio lexical search results') : []);
      return this.#publish({
        ...lexicalState,
        status: 'ready',
        mode: 'lexical-fallback',
        results: refreshed,
        lexical: refreshed,
        error: cleanError(error),
      });
    }
  }
}
