import { resolveCreativeObjectRepresentations, restyleOperationForAsset } from '../../packages/core/src/object-restyle.js';
import { AgentProposalSession } from './agent-proposal-session.js';
import { CreativeObjectRestyleSession } from './creative-object-restyle-session.js';
import { creativeObjectOptions, creativeObjectRestylePanelMarkup } from './creative-object-restyle-panel.js';
import { commitStudioOperations, getStudioGraph, getStudioModelRouter } from './studio-services.js';

let installed = false;
let refreshQueued = false;
let currentRouter = undefined;
let currentSession = null;
let selectedObjectId = '';
let busy = false;
let state = { status: 'idle', plan: null, review: null, error: null, restyle: null };

function noopProposalProvider() {
  return {
    id: 'studio-restyle-review',
    label: 'Studio Creative Object restyle review',
    capabilities: ['plan'],
    async plan() { throw new Error('Creative Object restyle adopts a generated graph-bound plan'); },
  };
}

export function creativeObjectRestyleCapabilities(graph, objectId, router, {
  resolveRepresentations = resolveCreativeObjectRepresentations,
  operationForAsset = restyleOperationForAsset,
} = {}) {
  const id = String(objectId ?? '').trim();
  if (!id) return { available: false, representationCount: 0, operations: [], missingOperations: [], reason: 'Choose a Creative Object.' };
  if (!router || typeof router.execute !== 'function' || typeof router.list !== 'function') {
    return { available: false, representationCount: 0, operations: [], missingOperations: [], reason: 'No generated-media model router is registered in Studio.' };
  }
  try {
    const representations = resolveRepresentations(graph, id);
    if (!representations.length) return { available: false, representationCount: 0, operations: [], missingOperations: [], reason: 'This Creative Object has no media representations to restyle.' };
    const operations = [...new Set(representations.map((representation) => operationForAsset(graph.nodes?.[representation.assetId])))].sort();
    const missingOperations = operations.filter((operation) => {
      try { return router.list(operation).length === 0; }
      catch { return true; }
    });
    return {
      available: missingOperations.length === 0,
      representationCount: representations.length,
      operations,
      missingOperations,
      reason: missingOperations.length ? 'Not every representation has a compatible generation backend.' : null,
    };
  } catch (error) {
    return { available: false, representationCount: 0, operations: [], missingOperations: [], reason: error?.message ?? String(error) };
  }
}

function restyleRoot() {
  return globalThis.document?.querySelector?.('.agent-workspace') ?? null;
}

function resolveRouter() {
  try { return getStudioModelRouter(); }
  catch { return null; }
}

function ensureSession(router) {
  if (currentSession && currentRouter === router) return currentSession;
  const proposalSession = new AgentProposalSession({
    provider: noopProposalProvider(),
    getGraph: getStudioGraph,
    commit: commitStudioOperations,
  });
  currentRouter = router;
  currentSession = new CreativeObjectRestyleSession({ router, getGraph: getStudioGraph, proposalSession });
  state = currentSession.snapshot();
  return currentSession;
}

function errorState(error) {
  return {
    status: 'idle',
    plan: null,
    review: null,
    restyle: null,
    error: { name: error?.name ?? 'CreativeObjectRestyleError', code: error?.code ?? 'CREATIVE_OBJECT_RESTYLE_FAILED', message: error?.message ?? String(error) },
  };
}

function refreshPanel() {
  refreshQueued = false;
  const root = restyleRoot();
  if (!root) return;
  let graph;
  try { graph = getStudioGraph(); }
  catch { return; }
  const objects = creativeObjectOptions(graph);
  if (!objects.some((item) => item.id === selectedObjectId)) selectedObjectId = objects[0]?.id ?? '';
  const router = resolveRouter();
  const capability = creativeObjectRestyleCapabilities(graph, selectedObjectId, router);
  const markup = creativeObjectRestylePanelMarkup({ graph, state, selectedObjectId, capability, busy });
  const existing = root.querySelector('[data-restyle-panel]');
  if (existing) {
    existing.outerHTML = markup;
    return;
  }
  const semantic = root.querySelector('[data-semantic-search]');
  if (semantic) semantic.insertAdjacentHTML('afterend', markup);
  else root.querySelector('#agent-form')?.insertAdjacentHTML('beforebegin', markup);
}

function queueRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  queueMicrotask(refreshPanel);
}

function scheduleRefresh() {
  setTimeout(queueRefresh, 0);
}

async function stageFromPanel(panel, { revise = false } = {}) {
  const objectId = String(panel.querySelector('[data-restyle-object]')?.value ?? selectedObjectId).trim();
  const intent = String(panel.querySelector('[data-restyle-intent]')?.value ?? '').trim();
  selectedObjectId = objectId;
  const graph = getStudioGraph();
  const router = resolveRouter();
  const capability = creativeObjectRestyleCapabilities(graph, objectId, router);
  if (!capability.available) throw new Error(capability.reason || `Missing backend capabilities: ${capability.missingOperations.join(', ')}`);
  busy = true;
  queueRefresh();
  try {
    const session = revise ? currentSession : ensureSession(router);
    if (!session || currentRouter !== router) throw new Error('The model router changed while a Creative Object restyle was pending; discard and stage again');
    state = revise ? await session.revise(intent) : await session.stage(objectId, intent);
  } finally {
    busy = false;
    queueRefresh();
  }
}

async function applyPending() {
  if (!currentSession?.hasPending()) return;
  busy = true;
  queueRefresh();
  try {
    const count = currentSession.snapshot().plan?.operations?.length ?? 0;
    const operationIndexes = Array.from({ length: count }, (_, index) => index);
    await currentSession.apply({ operationIndexes, metadata: { reviewSurface: 'studio-restyle' } });
    state = currentSession.snapshot();
  } finally {
    busy = false;
    queueRefresh();
  }
}

function discardPending() {
  if (!currentSession?.hasPending()) return;
  currentSession.discard();
  state = currentSession.snapshot();
  queueRefresh();
}

function handleSubmit(event) {
  const form = event.target?.matches?.('[data-restyle-form]') ? event.target : null;
  if (!form) return;
  event.preventDefault();
  const panel = form.closest('[data-restyle-panel]');
  if (!panel || busy || currentSession?.hasPending()) return;
  void stageFromPanel(panel).catch((error) => { busy = false; state = errorState(error); queueRefresh(); });
}

function handleClick(event) {
  if (event.target?.closest?.('[data-workspace="agent"]')) scheduleRefresh();
  const apply = event.target?.closest?.('[data-restyle-apply]');
  const discard = event.target?.closest?.('[data-restyle-discard]');
  const revise = event.target?.closest?.('[data-restyle-revise]');
  if (!apply && !discard && !revise) return;
  event.preventDefault();
  const panel = event.target.closest('[data-restyle-panel]');
  if (discard) {
    try { discardPending(); } catch (error) { state = errorState(error); queueRefresh(); }
  } else if (apply) {
    void applyPending().catch((error) => { busy = false; state = { ...currentSession.snapshot(), error: { name: error?.name ?? 'Error', code: error?.code ?? 'RESTYLE_APPLY_FAILED', message: error?.message ?? String(error) } }; queueRefresh(); });
  } else if (panel) {
    void stageFromPanel(panel, { revise: true }).catch((error) => { busy = false; state = errorState(error); queueRefresh(); });
  }
}

function handleChange(event) {
  if (!event.target?.matches?.('[data-restyle-object]')) return;
  if (currentSession?.hasPending()) return;
  selectedObjectId = String(event.target.value ?? '');
  state = { status: 'idle', plan: null, review: null, error: null, restyle: null };
  queueRefresh();
}

export function installStudioCreativeObjectRestyleBridge() {
  if (installed) return;
  installed = true;
  globalThis.document?.addEventListener?.('submit', handleSubmit, true);
  globalThis.document?.addEventListener?.('click', handleClick, true);
  globalThis.document?.addEventListener?.('change', handleChange, true);
  scheduleRefresh();
}
