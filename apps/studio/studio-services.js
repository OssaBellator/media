let graphProvider = null;
let nodeSelector = null;
let modelRouterProvider = null;
let commitProvider = null;
const MAX_STUDIO_NODE_ID_CHARS = 1024;

function requireFunction(value, label) {
  if (typeof value !== 'function') throw new Error(`${label} must be a function`);
  return value;
}

function ownDataField(value, key, label) {
  if (!value || typeof value !== 'object') throw new Error(`${label} must be an object`);
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error(`${label} ${key} must be an enumerable data property`);
  return descriptor.value;
}

function hasDataMethod(value, name) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
  let owner = value;
  while (owner) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, name);
    if (descriptor) return Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'function';
    owner = Object.getPrototypeOf(owner);
  }
  return false;
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
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) throw new Error('Studio graph provider returned an invalid graph');
  const projectId = ownDataField(graph, 'projectId', 'Studio graph');
  const nodes = ownDataField(graph, 'nodes', 'Studio graph');
  if (typeof projectId !== 'string' || !projectId || !nodes || typeof nodes !== 'object' || Array.isArray(nodes)) throw new Error('Studio graph provider returned an invalid graph');
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
  if (typeof nodeId !== 'string' || !nodeId.trim()) throw new Error('Studio node selection requires a non-empty string node id');
  const id = nodeId.trim();
  if (id.length > MAX_STUDIO_NODE_ID_CHARS) throw new Error(`Studio node selection id exceeds ${MAX_STUDIO_NODE_ID_CHARS} characters`);
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
  if (!hasDataMethod(router, 'execute') || !hasDataMethod(router, 'list')) throw new Error('Studio model router provider returned an invalid router');
  return router;
}

export function registerStudioCommitProvider(provider) {
  const next = requireFunction(provider, 'Studio commit provider');
  const previous = commitProvider;
  commitProvider = next;
  return restoreRegistration(next, previous, () => commitProvider, (value) => { commitProvider = value; });
}

export function commitStudioOperations(label, operations, metadata = {}, options = {}) {
  if (!commitProvider) throw new Error('Studio commit provider is not registered');
  if (typeof label !== 'string' || !label.trim()) throw new Error('Studio commit requires a non-empty label');
  if (!Array.isArray(operations)) throw new Error('Studio commit operations must be an array');
  return commitProvider(label.trim(), operations, metadata, options);
}
