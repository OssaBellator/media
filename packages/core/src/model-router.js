import { normalizeBoundedModelJsonObject } from './model-input.js';

export const MODEL_OPERATIONS = Object.freeze([
  'plan', 'plan-workflow', 'embed', 'analyze-media', 'generate-image', 'edit-image', 'generate-video', 'edit-video',
  'generate-audio', 'edit-audio', 'transcribe', 'synthesize-speech',
]);
export const MODEL_DATA_POLICIES = Object.freeze(['any', 'trusted', 'local']);
export const MAX_MODEL_ROUTING_BACKEND_IDS = 256;
export const MAX_MODEL_ROUTING_BACKEND_ID_CHARS = 160;
export const MAX_MODEL_ROUTER_OPTIONS_BYTES = 64 * 1024;
const MODEL_OPERATION_SET = new Set(MODEL_OPERATIONS);
const MODEL_DATA_POLICY_SET = new Set(MODEL_DATA_POLICIES);
const MODEL_ROUTING_POLICY_KEYS = new Set(['allowedBackendIds', 'deniedBackendIds', 'maxCostTier', 'dataPolicy', 'preferLocal']);

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}
function normalizeOperations(operations) {
  if (!Array.isArray(operations) || !operations.length) throw new Error('Model backend requires operations');
  const normalized = [...new Set(operations.map((operation) => requireString(operation, 'Model operation')))];
  for (const operation of normalized) if (!MODEL_OPERATION_SET.has(operation)) throw new Error(`Unsupported model operation: ${operation}`);
  return normalized;
}
function normalizeCostTier(value) {
  const number = Number(value ?? 0);
  if (!Number.isInteger(number) || number < 0 || number > 3) throw new Error('Model backend costTier must be an integer from 0 to 3');
  return number;
}
function normalizeDataPolicy(value = 'any') {
  if (!MODEL_DATA_POLICY_SET.has(value)) throw new Error(`Unsupported model data policy: ${value}`);
  return value;
}
function abortError() {
  const error = new Error('Model operation aborted');
  error.name = 'AbortError';
  return error;
}
function backendAllowedByDataPolicy(backend, dataPolicy) {
  if (dataPolicy === 'local') return backend.location === 'local';
  if (dataPolicy === 'trusted') return backend.location === 'local' || backend.trusted;
  return true;
}
function normalizeRoutingBackendIds(value, label, { nullable = false } = {}) {
  if (value == null && nullable) return null;
  const list = value == null ? [] : value;
  if (!Array.isArray(list)) throw new Error(`${label} must be an array`);
  if (list.length > MAX_MODEL_ROUTING_BACKEND_IDS) throw new Error(`${label} exceeds ${MAX_MODEL_ROUTING_BACKEND_IDS} ids`);
  return [...new Set(list.map((value) => {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must contain non-empty string ids`);
    const id = value.trim();
    if (id.length > MAX_MODEL_ROUTING_BACKEND_ID_CHARS) throw new Error(`${label} id exceeds ${MAX_MODEL_ROUTING_BACKEND_ID_CHARS} characters`);
    return id;
  }))];
}
export function normalizeModelRoutingPolicy(policy = {}) {
  const clean = normalizeBoundedModelJsonObject(policy, 'Model routing policy', { maxBytes: MAX_MODEL_ROUTER_OPTIONS_BYTES });
  for (const key of Object.keys(clean)) if (!MODEL_ROUTING_POLICY_KEYS.has(key)) throw new Error(`Unsupported model routing policy field: ${key}`);
  const allowedBackendIds = normalizeRoutingBackendIds(clean.allowedBackendIds, 'Model routing allowedBackendIds', { nullable: true });
  const deniedBackendIds = normalizeRoutingBackendIds(clean.deniedBackendIds, 'Model routing deniedBackendIds');
  const maxCostTier = clean.maxCostTier ?? 3;
  if (!Number.isInteger(maxCostTier) || maxCostTier < 0 || maxCostTier > 3) throw new Error('Model routing maxCostTier must be an integer between 0 and 3');
  if (clean.preferLocal !== undefined && typeof clean.preferLocal !== 'boolean') throw new Error('Model routing preferLocal must be a boolean');
  return { allowedBackendIds, deniedBackendIds, maxCostTier, dataPolicy: normalizeDataPolicy(clean.dataPolicy ?? 'any'), preferLocal: clean.preferLocal ?? false };
}
function normalizeRoutingPolicy(policy = {}) {
  const clean = normalizeModelRoutingPolicy(policy);
  return {
    allowed: clean.allowedBackendIds == null ? null : new Set(clean.allowedBackendIds),
    denied: new Set(clean.deniedBackendIds),
    maxCostTier: clean.maxCostTier,
    dataPolicy: clean.dataPolicy,
    preferLocal: clean.preferLocal,
  };
}

export class ModelUnsupportedError extends Error {
  constructor(operation, attempts = []) {
    super(`No model backend supports operation: ${operation}`);
    this.name = 'ModelUnsupportedError';
    this.code = 'MODEL_UNSUPPORTED';
    this.operation = operation;
    this.attempts = attempts;
  }
}

export function unsupportedModelResult(reason = 'unsupported') {
  return { supported: false, reason: String(reason) };
}

export function createModelBackend({
  id,
  label = id,
  operations,
  priority = 0,
  location = 'remote',
  trusted = false,
  costTier = 0,
  metadata = {},
  invoke,
} = {}) {
  const backendId = requireString(id, 'Model backend id');
  if (!['local', 'remote'].includes(location)) throw new Error(`Unsupported model backend location: ${location}`);
  if (typeof invoke !== 'function') throw new Error(`Model backend ${backendId} requires invoke`);
  return Object.freeze({
    id: backendId,
    label: String(label ?? backendId),
    operations: Object.freeze(normalizeOperations(operations)),
    priority: Number(priority) || 0,
    location,
    trusted: location === 'local' ? true : Boolean(trusted),
    costTier: normalizeCostTier(costTier),
    metadata: Object.freeze({ ...metadata }),
    invoke,
  });
}

export class ModelRouter {
  #backends = new Map();

  register(backend) {
    const valid = createModelBackend(backend);
    this.#backends.set(valid.id, valid);
    return this;
  }
  unregister(id) { return this.#backends.delete(String(id)); }
  get(id) { return this.#backends.get(String(id)) ?? null; }
  list(operation = null, policy = {}) {
    if (operation != null && !MODEL_OPERATION_SET.has(operation)) throw new Error(`Unsupported model operation: ${operation}`);
    const route = normalizeRoutingPolicy(policy);
    return [...this.#backends.values()]
      .filter((backend) => !operation || backend.operations.includes(operation))
      .filter((backend) => !route.allowed || route.allowed.has(backend.id))
      .filter((backend) => !route.denied.has(backend.id))
      .filter((backend) => backend.costTier <= route.maxCostTier)
      .filter((backend) => backendAllowedByDataPolicy(backend, route.dataPolicy))
      .sort((a, b) => (route.preferLocal ? Number(b.location === 'local') - Number(a.location === 'local') : 0) || b.priority - a.priority || a.id.localeCompare(b.id));
  }
  async execute(operation, input, { signal, context = {}, policy = {} } = {}) {
    if (!MODEL_OPERATION_SET.has(operation)) throw new Error(`Unsupported model operation: ${operation}`);
    if (signal?.aborted) throw abortError();
    const cleanContext = normalizeBoundedModelJsonObject(context, 'Model execution context', { maxBytes: MAX_MODEL_ROUTER_OPTIONS_BYTES });
    const attempts = [];
    const candidates = this.list(operation, policy);
    for (const backend of candidates) {
      if (signal?.aborted) throw abortError();
      let result;
      try {
        result = await backend.invoke(operation, input, { signal, context: cleanContext, backend });
      } catch (error) {
        error.modelBackendId ??= backend.id;
        throw error;
      }
      if (result?.supported === false) {
        attempts.push({ backendId: backend.id, supported: false, reason: String(result.reason ?? 'unsupported') });
        continue;
      }
      attempts.push({ backendId: backend.id, supported: true });
      return { backendId: backend.id, backend, output: result?.output ?? result, attempts };
    }
    throw new ModelUnsupportedError(operation, attempts);
  }
}
