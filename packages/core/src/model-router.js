import { normalizeBoundedModelInput, normalizeBoundedModelJsonObject } from './model-input.js';

export const MODEL_OPERATIONS = Object.freeze([
  'plan', 'plan-workflow', 'embed', 'analyze-media', 'generate-image', 'edit-image', 'generate-video', 'edit-video',
  'generate-audio', 'edit-audio', 'transcribe', 'synthesize-speech',
]);
export const MODEL_DATA_POLICIES = Object.freeze(['any', 'trusted', 'local']);
export const MAX_MODEL_ROUTING_BACKEND_IDS = 256;
export const MAX_MODEL_ROUTING_BACKEND_ID_CHARS = 160;
export const MAX_MODEL_ROUTER_OPTIONS_BYTES = 64 * 1024;
export const MAX_MODEL_BACKEND_LABEL_CHARS = 256;
export const MAX_MODEL_BACKEND_METADATA_BYTES = 64 * 1024;
export const MAX_MODEL_ROUTER_BACKENDS = 256;
export const MAX_MODEL_ATTEMPT_REASON_CHARS = 512;
const MODEL_OPERATION_SET = new Set(MODEL_OPERATIONS);
const MODEL_DATA_POLICY_SET = new Set(MODEL_DATA_POLICIES);
const MODEL_ROUTING_POLICY_KEYS = new Set(['allowedBackendIds', 'deniedBackendIds', 'maxCostTier', 'dataPolicy', 'preferLocal']);
const MODEL_BACKEND_DESCRIPTOR_KEYS = new Set(['id', 'label', 'operations', 'priority', 'location', 'trusted', 'costTier', 'metadata', 'invoke']);

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}
function requireBoundedString(value, label, maxChars) {
  const clean = requireString(value, label);
  if (clean.length > maxChars) throw new Error(`${label} exceeds ${maxChars} characters`);
  return clean;
}
function normalizeOperations(operations) {
  if (!Array.isArray(operations) || !operations.length) throw new Error('Model backend requires operations');
  const clean = normalizeBoundedModelInput(operations, 'Model backend operations', { maxBytes: 4096, maxDepth: 2, maxEntries: MODEL_OPERATIONS.length, allowBinary: false });
  const normalized = [...new Set(clean.map((operation) => requireString(operation, 'Model operation')))];
  for (const operation of normalized) if (!MODEL_OPERATION_SET.has(operation)) throw new Error(`Unsupported model operation: ${operation}`);
  return normalized;
}
function normalizeCostTier(value = 0) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 3) throw new Error('Model backend costTier must be an integer from 0 to 3');
  return value;
}
function normalizeBackendDescriptor(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Model backend descriptor must be an object');
  const prototype = Object.getPrototypeOf(config);
  if (prototype !== Object.prototype && prototype !== null) throw new Error('Model backend descriptor must be a plain data object');
  const descriptors = Object.getOwnPropertyDescriptors(config);
  const clean = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string') throw new Error('Model backend descriptor cannot contain symbol fields');
    if (!MODEL_BACKEND_DESCRIPTOR_KEYS.has(key)) throw new Error(`Unsupported model backend field: ${key}`);
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !('value' in descriptor)) throw new Error('Model backend descriptor must contain enumerable data fields only');
    Object.defineProperty(clean, key, { value: descriptor.value, enumerable: true, writable: true, configurable: true });
  }
  return clean;
}
function deepFreezeJson(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreezeJson(child);
  return Object.freeze(value);
}
function boundedUnsupportedReason(value) {
  if (typeof value !== 'string') return 'unsupported';
  const clean = value.trim() || 'unsupported';
  return clean.slice(0, MAX_MODEL_ATTEMPT_REASON_CHARS);
}
function unsupportedReasonFromResult(result) {
  if (!result || typeof result !== 'object') return null;
  const supported = Object.getOwnPropertyDescriptor(result, 'supported');
  if (!supported || !('value' in supported) || supported.value !== false) return null;
  const reason = Object.getOwnPropertyDescriptor(result, 'reason');
  return boundedUnsupportedReason(reason && 'value' in reason ? reason.value : undefined);
}
function outputFromResult(result) {
  if (!result || typeof result !== 'object') return result;
  const output = Object.getOwnPropertyDescriptor(result, 'output');
  return output && 'value' in output && output.value != null ? output.value : result;
}
function safeBackendErrorMessage(error) {
  if (typeof error === 'string') return error.slice(0, MAX_MODEL_ATTEMPT_REASON_CHARS) || 'Model backend failed';
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) return 'Model backend failed';
  const message = Object.getOwnPropertyDescriptor(error, 'message');
  return message && 'value' in message && typeof message.value === 'string'
    ? (message.value.slice(0, MAX_MODEL_ATTEMPT_REASON_CHARS) || 'Model backend failed')
    : 'Model backend failed';
}
function tagBackendError(error, backendId) {
  if (error && (typeof error === 'object' || typeof error === 'function') && Object.isExtensible(error)) {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'modelBackendId');
    if (!descriptor || descriptor.configurable || ('value' in descriptor && descriptor.writable)) {
      try {
        Object.defineProperty(error, 'modelBackendId', { value: backendId, enumerable: false, writable: true, configurable: true });
        return error;
      } catch {}
    }
  }
  const wrapped = new Error(safeBackendErrorMessage(error), { cause: error });
  wrapped.name = 'ModelBackendError';
  wrapped.code = 'MODEL_BACKEND_FAILED';
  wrapped.modelBackendId = backendId;
  return wrapped;
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
    this.attempts = Object.freeze([...attempts]);
  }
}

export function unsupportedModelResult(reason = 'unsupported') {
  return Object.freeze({ supported: false, reason: boundedUnsupportedReason(reason) });
}

export function createModelBackend(config = {}) {
  const clean = normalizeBackendDescriptor(config);
  const backendId = requireBoundedString(clean.id, 'Model backend id', MAX_MODEL_ROUTING_BACKEND_ID_CHARS);
  const label = clean.label === undefined ? backendId : requireBoundedString(clean.label, 'Model backend label', MAX_MODEL_BACKEND_LABEL_CHARS);
  const priority = clean.priority ?? 0;
  const location = clean.location ?? 'remote';
  const trusted = clean.trusted ?? false;
  const costTier = clean.costTier ?? 0;
  const metadata = normalizeBoundedModelJsonObject(clean.metadata ?? {}, 'Model backend metadata', { maxBytes: MAX_MODEL_BACKEND_METADATA_BYTES });
  if (typeof priority !== 'number' || !Number.isFinite(priority)) throw new Error('Model backend priority must be a finite number');
  if (!['local', 'remote'].includes(location)) throw new Error(`Unsupported model backend location: ${location}`);
  if (typeof trusted !== 'boolean') throw new Error('Model backend trusted must be a boolean');
  if (typeof clean.invoke !== 'function') throw new Error(`Model backend ${backendId} requires invoke`);
  return Object.freeze({
    id: backendId,
    label,
    operations: Object.freeze(normalizeOperations(clean.operations)),
    priority,
    location,
    trusted: location === 'local' ? true : trusted,
    costTier: normalizeCostTier(costTier),
    metadata: deepFreezeJson(metadata),
    invoke: clean.invoke,
  });
}

export class ModelRouter {
  #backends = new Map();

  register(backend) {
    const valid = createModelBackend(backend);
    if (!this.#backends.has(valid.id) && this.#backends.size >= MAX_MODEL_ROUTER_BACKENDS) throw new Error(`Model router exceeds ${MAX_MODEL_ROUTER_BACKENDS} backends`);
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
        throw tagBackendError(error, backend.id);
      }
      const unsupportedReason = unsupportedReasonFromResult(result);
      if (unsupportedReason != null) {
        attempts.push(Object.freeze({ backendId: backend.id, supported: false, reason: unsupportedReason }));
        continue;
      }
      attempts.push(Object.freeze({ backendId: backend.id, supported: true }));
      return { backendId: backend.id, backend, output: outputFromResult(result), attempts: Object.freeze([...attempts]) };
    }
    throw new ModelUnsupportedError(operation, attempts);
  }
}
