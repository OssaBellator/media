export const MODEL_OPERATIONS = Object.freeze([
  'plan', 'embed', 'generate-image', 'edit-image', 'generate-video', 'edit-video',
  'generate-audio', 'edit-audio', 'transcribe', 'synthesize-speech',
]);
export const MODEL_DATA_POLICIES = Object.freeze(['any', 'trusted', 'local']);
const MODEL_OPERATION_SET = new Set(MODEL_OPERATIONS);
const MODEL_DATA_POLICY_SET = new Set(MODEL_DATA_POLICIES);

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
function normalizeRoutingPolicy(policy = {}) {
  const allowed = policy.allowedBackendIds == null ? null : new Set(policy.allowedBackendIds.map(String));
  const denied = new Set((policy.deniedBackendIds ?? []).map(String));
  const maxCostTier = Math.max(0, Math.min(3, Math.floor(Number(policy.maxCostTier ?? 3))));
  return { allowed, denied, maxCostTier, dataPolicy: normalizeDataPolicy(policy.dataPolicy ?? 'any'), preferLocal: Boolean(policy.preferLocal) };
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
    const attempts = [];
    const candidates = this.list(operation, policy);
    for (const backend of candidates) {
      if (signal?.aborted) throw abortError();
      let result;
      try {
        result = await backend.invoke(operation, input, { signal, context, backend });
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
