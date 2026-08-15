let graphProvider = null;
let nodeSelector = null;
let modelRouterProvider = null;

function requireFunction(value, label) {
  if (typeof value !== 'function') throw new Error(`${label} must be a function`);
  return value;
}

function restoreRegistration(current, previous, getCurrent, setCurrent) {
  return () => {
    if (getCurrent() === current) setCurrent(previous);
  };
}

export function registerStudioGraphProvider(provider) {
  const next = requireFunction(provider, 'Studio graph provider');
  const previous = graphProvider;
  graphProvider = next;
  return restoreRegistration(next, previous, () => graphProvider, (value) => { graphProvider = value; });
}

export function getStudioGraph() {
  if (!graphProvider) throw new Error('Studio graph provider is not registered');
  const graph = graphProvider();
  if (!graph || typeof graph !== 'object' || typeof graph.projectId !== 'string' || !graph.nodes || typeof graph.nodes !== 'object') {
    throw new Error('Studio graph provider returned an invalid graph');
  }
  return graph;
}

export function registerStudioNodeSelector(selector) {
  const next = requireFunction(selector, 'Studio node selector');
  const previous = nodeSelector;
  nodeSelector = next;
  return restoreRegistration(next, previous, () => nodeSelector, (value) => { nodeSelector = value; });
}

export function selectStudioNode(nodeId) {
  if (!nodeSelector) throw new Error('Studio node selector is not registered');
  const id = String(nodeId ?? '').trim();
  if (!id) throw new Error('Studio node selection requires a non-empty node id');
  return nodeSelector(id);
}

export function registerStudioModelRouterProvider(provider) {
  const next = requireFunction(provider, 'Studio model router provider');
  const previous = modelRouterProvider;
  modelRouterProvider = next;
  return restoreRegistration(next, previous, () => modelRouterProvider, (value) => { modelRouterProvider = value; });
}

export function getStudioModelRouter() {
  if (!modelRouterProvider) return null;
  const router = modelRouterProvider();
  if (router == null) return null;
  if (typeof router.execute !== 'function' || typeof router.list !== 'function') throw new Error('Studio model router provider returned an invalid router');
  return router;
}
