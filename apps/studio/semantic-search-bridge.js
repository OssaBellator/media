import { SemanticEmbeddingCache } from './semantic-embedding-cache.js';
import { StudioSemanticSearchSession } from './semantic-search-session.js';
import { semanticSearchPanelMarkup } from './semantic-search-panel.js';
import { getStudioGraph, getStudioModelRouter, selectStudioNode } from './studio-services.js';

let installed = false;
let refreshQueued = false;
let currentSession = null;
let currentRouter = undefined;
let currentEmbeddingAvailable = false;
let useEmbeddings = true;
let state = {
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

function routerDataMethod(router, name) {
  if (!router || (typeof router !== 'object' && typeof router !== 'function')) return null;
  let owner = router;
  while (owner) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, name);
    if (descriptor) return Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'function' ? descriptor.value.bind(router) : null;
    owner = Object.getPrototypeOf(owner);
  }
  return null;
}

export function semanticSearchEmbeddingAvailable(router) {
  const execute = routerDataMethod(router, 'execute');
  const list = routerDataMethod(router, 'list');
  if (!execute || !list) return false;
  try {
    const backends = list('embed');
    return Array.isArray(backends) && backends.length > 0;
  } catch { return false; }
}

function resolveRouter() {
  try { return getStudioModelRouter(); }
  catch { return null; }
}

function searchRoot() {
  return globalThis.document?.querySelector?.('.agent-workspace') ?? null;
}

function refreshPanel() {
  refreshQueued = false;
  const root = searchRoot();
  if (!root) return;
  const markup = semanticSearchPanelMarkup(state, { embeddingAvailable: currentEmbeddingAvailable, useEmbeddings });
  const existing = root.querySelector('[data-semantic-search]');
  if (existing) {
    existing.outerHTML = markup;
    return;
  }
  const agentForm = root.querySelector('#agent-form');
  if (agentForm) agentForm.insertAdjacentHTML('beforebegin', markup);
}

function queueRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  queueMicrotask(refreshPanel);
}

function scheduleRefresh() {
  setTimeout(queueRefresh, 0);
}

function ensureSearchSession() {
  const router = resolveRouter();
  const embeddingAvailable = semanticSearchEmbeddingAvailable(router);
  if (currentSession && currentRouter === router && currentEmbeddingAvailable === embeddingAvailable) return currentSession;
  currentRouter = router;
  currentEmbeddingAvailable = embeddingAvailable;
  const embeddingCache = embeddingAvailable ? new SemanticEmbeddingCache({ router }) : null;
  currentSession = new StudioSemanticSearchSession({
    getGraph: getStudioGraph,
    router: embeddingAvailable ? router : null,
    embeddingCache,
    onUpdate(next) {
      state = next;
      queueRefresh();
    },
  });
  return currentSession;
}

function unavailableState(query) {
  return {
    status: 'ready',
    mode: 'lexical-fallback',
    query,
    results: [],
    lexical: [],
    embedded: [],
    cache: null,
    error: { name: 'StudioSemanticSearchUnavailable', code: 'STUDIO_SEARCH_UNAVAILABLE', message: 'Studio graph search is unavailable' },
    superseded: false,
  };
}

async function runSearch(form) {
  const input = form.querySelector('[data-semantic-query]');
  const query = String(input?.value ?? '').trim();
  useEmbeddings = Boolean(form.querySelector('[data-semantic-embeddings]')?.checked);
  try {
    const session = ensureSearchSession();
    await session.search(query, { useEmbeddings: useEmbeddings && currentEmbeddingAvailable });
  } catch {
    state = unavailableState(query);
    queueRefresh();
  }
}

function handleSubmit(event) {
  const form = event.target?.matches?.('[data-semantic-search-form]') ? event.target : null;
  if (!form) return;
  event.preventDefault();
  void runSearch(form);
}

function handleClick(event) {
  if (event.target?.closest?.('[data-workspace="agent"]')) scheduleRefresh();
  const result = event.target?.closest?.('[data-semantic-result-id]');
  if (!result) return;
  event.preventDefault();
  const nodeId = String(result.dataset.semanticResultId ?? '');
  if (!nodeId) return;
  try { selectStudioNode(nodeId); }
  catch { return; }
  scheduleRefresh();
}

function handleChange(event) {
  if (!event.target?.matches?.('[data-semantic-embeddings]')) return;
  useEmbeddings = Boolean(event.target.checked);
}

export function installStudioSemanticSearchBridge() {
  if (installed) return;
  installed = true;
  globalThis.document?.addEventListener?.('submit', handleSubmit, true);
  globalThis.document?.addEventListener?.('click', handleClick, true);
  globalThis.document?.addEventListener?.('change', handleChange, true);
  scheduleRefresh();
}
