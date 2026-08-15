import { searchSemanticGraph } from '../../packages/core/src/semantic-search.js';
import { embedSemanticQuery, semanticEmbeddingSourceFingerprint } from '../../packages/core/src/semantic-embedding.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;
const RRF_OFFSET = 60;

function requireFunction(value, label) {
  if (typeof value !== 'function') throw new Error(`${label} must be a function`);
  return value;
}
function boundedLimit(value) {
  const number = Math.round(Number(value) || DEFAULT_LIMIT);
  return Math.max(1, Math.min(MAX_LIMIT, number));
}
function cleanError(error) {
  if (!error) return null;
  return {
    name: String(error.name ?? 'Error'),
    code: error.code == null ? null : String(error.code),
    message: String(error.message ?? error).slice(0, 1024),
  };
}
function cacheSnapshot(result) {
  if (!result) return null;
  return {
    cached: Boolean(result.cached),
    key: typeof result.key === 'string' ? result.key : null,
    cacheReadError: cleanError(result.cacheReadError),
    cacheWriteError: cleanError(result.cacheWriteError),
  };
}
function cloneResult(result) {
  return {
    ...result,
    ...(Array.isArray(result.matchedTerms) ? { matchedTerms: [...result.matchedTerms] } : {}),
    ...(result.sources && typeof result.sources === 'object' ? { sources: structuredClone(result.sources) } : {}),
  };
}
function snapshotState(state) {
  return {
    ...state,
    results: state.results.map(cloneResult),
    lexical: state.lexical.map(cloneResult),
    embedded: state.embedded.map(cloneResult),
    cache: state.cache ? { ...state.cache, cacheReadError: state.cache.cacheReadError ? { ...state.cache.cacheReadError } : null, cacheWriteError: state.cache.cacheWriteError ? { ...state.cache.cacheWriteError } : null } : null,
    error: state.error ? { ...state.error } : null,
  };
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
  constructor({ getGraph, router = null, embeddingCache = null, onUpdate = null, lexicalSearch = searchSemanticGraph, embedQuery = embedSemanticQuery, sourceFingerprint = semanticEmbeddingSourceFingerprint } = {}) {
    this.getGraph = requireFunction(getGraph, 'Studio semantic search getGraph');
    if (router != null && typeof router.execute !== 'function') throw new Error('Studio semantic search router must expose execute');
    if (embeddingCache != null && typeof embeddingCache.getOrCreate !== 'function') throw new Error('Studio semantic search embedding cache must expose getOrCreate');
    if (onUpdate != null && typeof onUpdate !== 'function') throw new Error('Studio semantic search onUpdate must be a function');
    this.lexicalSearch = requireFunction(lexicalSearch, 'Studio semantic lexicalSearch');
    this.embedQuery = requireFunction(embedQuery, 'Studio semantic embedQuery');
    this.sourceFingerprint = requireFunction(sourceFingerprint, 'Studio semantic sourceFingerprint');
    this.router = router;
    this.embeddingCache = embeddingCache;
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

  searchLexical(query, { limit = DEFAULT_LIMIT, kinds = null } = {}) {
    this.requestId += 1;
    const cleanQuery = typeof query === 'string' ? query.trim() : '';
    const maxResults = boundedLimit(limit);
    const lexical = cleanQuery ? this.lexicalSearch(this.getGraph(), cleanQuery, { limit: maxResults, kinds }) : [];
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

  async search(query, {
    limit = DEFAULT_LIMIT,
    kinds = null,
    policy = {},
    signal,
    useEmbeddings = true,
    embeddingLimit = null,
    ...indexOptions
  } = {}) {
    const cleanQuery = typeof query === 'string' ? query.trim() : '';
    const maxResults = boundedLimit(limit);
    const requestId = ++this.requestId;
    const graph = this.getGraph();
    const lexical = cleanQuery ? this.lexicalSearch(graph, cleanQuery, { limit: maxResults, kinds }) : [];
    const canEmbed = Boolean(cleanQuery && useEmbeddings && this.router && this.embeddingCache);
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
      const cached = await this.embeddingCache.getOrCreate(graph, { kinds, policy, signal, ...indexOptions });
      const cache = cacheSnapshot(cached);
      if (requestId !== this.requestId) return { ...snapshotState(lexicalState), status: 'ready', cache, superseded: true };
      if (!cached?.index?.dimensions || !cached.index.documents?.length) {
        return this.#publish({ ...lexicalState, status: 'ready', cache });
      }
      let currentGraph = this.getGraph();
      let currentLexical = currentGraph === graph ? lexical : (cleanQuery ? this.lexicalSearch(currentGraph, cleanQuery, { limit: maxResults, kinds }) : []);
      let currentSourceFingerprint = this.sourceFingerprint(currentGraph, { kinds });
      if (currentSourceFingerprint !== cached.index.sourceFingerprint) {
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
      const embedded = await this.embedQuery(this.router, cached.index, cleanQuery, {
        policy,
        signal,
        limit: boundedLimit(embeddingLimit ?? Math.min(MAX_LIMIT, maxResults * 4)),
        kinds,
      });
      if (requestId !== this.requestId) return { ...snapshotState(lexicalState), status: 'ready', cache, embedded, superseded: true };
      const latestGraph = this.getGraph();
      if (latestGraph !== currentGraph) {
        currentGraph = latestGraph;
        currentLexical = cleanQuery ? this.lexicalSearch(currentGraph, cleanQuery, { limit: maxResults, kinds }) : [];
        currentSourceFingerprint = this.sourceFingerprint(currentGraph, { kinds });
        if (currentSourceFingerprint !== cached.index.sourceFingerprint) {
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
      const refreshed = currentGraph === graph ? lexical : (cleanQuery ? this.lexicalSearch(currentGraph, cleanQuery, { limit: maxResults, kinds }) : []);
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
