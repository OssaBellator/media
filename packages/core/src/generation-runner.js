import { canonicalOperationLogJson } from './operation-log.js';
import { createGeneratedAssetOperations, createGenerationRecord, GENERATED_MEDIA_OPERATIONS, MAX_GENERATION_INTENT_CHARS, MAX_GENERATION_RECORD_BYTES } from './generated-media.js';
import { DEFAULT_MODEL_INPUT_BYTES, DEFAULT_MODEL_OPTIONS_BYTES, normalizeBoundedModelInput, normalizeBoundedModelJsonObject } from './model-input.js';
import { createPlannerSnapshot } from './providers.js';

const GENERATED_OPERATION_SET = new Set(GENERATED_MEDIA_OPERATIONS);
const GENERATED_MODEL_RESULT_KEYS = new Set(['artifact', 'metadata', 'payload']);
export const MAX_GENERATION_CONTEXT_IDS = 1024;
export const MAX_GENERATED_MODEL_DESCRIPTOR_BYTES = MAX_GENERATION_RECORD_BYTES;
export const MAX_GENERATION_CONTEXT_ID_CHARS = 512;
export const MAX_GENERATION_MODEL_INPUT_BYTES = DEFAULT_MODEL_INPUT_BYTES;
export const MAX_GENERATION_MODEL_OPTIONS_BYTES = DEFAULT_MODEL_OPTIONS_BYTES;

function cloneJson(value, label) {
  try { return JSON.parse(canonicalOperationLogJson(value)); }
  catch (error) { throw new Error(`${label} must be JSON-safe: ${error.message}`, { cause: error }); }
}
function uniqueIds(values, label) {
  if (!Array.isArray(values)) throw new Error(`${label} must be an array`);
  if (values.length > MAX_GENERATION_CONTEXT_IDS) throw new Error(`${label} exceeds ${MAX_GENERATION_CONTEXT_IDS} ids`);
  const ids = [...new Set(values.map((value) => {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must contain non-empty string ids`);
    const id = value.trim();
    if (id.length > MAX_GENERATION_CONTEXT_ID_CHARS) throw new Error(`${label} id exceeds ${MAX_GENERATION_CONTEXT_ID_CHARS} characters`);
    return id;
  }))];
  if (ids.length > MAX_GENERATION_CONTEXT_IDS) throw new Error(`${label} exceeds ${MAX_GENERATION_CONTEXT_IDS} ids`);
  return ids;
}
function optionalGenerationId(value, label) {
  if (value == null) return null;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  const id = value.trim();
  if (id.length > MAX_GENERATION_CONTEXT_ID_CHARS) throw new Error(`${label} exceeds ${MAX_GENERATION_CONTEXT_ID_CHARS} characters`);
  return id;
}
function normalizeGenerationIntent(value) {
  if (typeof value !== 'string') throw new Error('Generation intent must be a string');
  if (value.length > MAX_GENERATION_INTENT_CHARS) throw new Error(`Generation intent exceeds ${MAX_GENERATION_INTENT_CHARS} characters`);
  return value;
}

export function assertGeneratedModelResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Generated model result must be an object');
  const prototype = Object.getPrototypeOf(result);
  if (prototype !== Object.prototype && prototype !== null) throw new Error('Generated model result must be a plain data object');
  const descriptors = Object.getOwnPropertyDescriptors(result);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !GENERATED_MODEL_RESULT_KEYS.has(key)) throw new Error(`Unsupported generated model result field: ${String(key)}`);
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !('value' in descriptor)) throw new Error('Generated model result must contain enumerable data fields only');
  }
  const artifactValue = descriptors.artifact?.value;
  if (!artifactValue || typeof artifactValue !== 'object' || Array.isArray(artifactValue)) throw new Error('Generated model result requires an artifact descriptor');
  const artifact = normalizeBoundedModelJsonObject(artifactValue, 'Generated artifact descriptor', { maxBytes: MAX_GENERATED_MODEL_DESCRIPTOR_BYTES });
  if (typeof artifact.name !== 'string' || !artifact.name.trim()) throw new Error('Generated artifact requires a name');
  if (typeof artifact.mimeType !== 'string' || !artifact.mimeType.trim()) throw new Error('Generated artifact requires a mimeType');
  const metadata = descriptors.metadata === undefined
    ? undefined
    : normalizeBoundedModelJsonObject(descriptors.metadata.value, 'Generated model metadata', { maxBytes: MAX_GENERATED_MODEL_DESCRIPTOR_BYTES });
  return Object.freeze({ artifact, ...(descriptors.payload ? { payload: descriptors.payload.value } : {}), ...(metadata !== undefined ? { metadata } : {}) });
}

export async function runGeneratedMediaModel(router, graph, {
  operation,
  intent = '',
  settings = {},
  sourceNodeIds = [],
  creativeObjectIds = [],
  parentPlanId = null,
  requestId = null,
  policy = {},
  context = {},
  modelInput = {},
  signal,
} = {}) {
  if (!router || typeof router.execute !== 'function') throw new Error('Generated media runner requires a model router');
  if (!GENERATED_OPERATION_SET.has(operation)) throw new Error(`Unsupported generated media operation: ${operation}`);
  const sources = uniqueIds(sourceNodeIds, 'Generation sourceNodeIds');
  const objects = uniqueIds(creativeObjectIds, 'Generation creativeObjectIds');
  for (const sourceId of sources) if (!graph.nodes[sourceId]) throw new Error(`Unknown generation source node: ${sourceId}`);
  for (const objectId of objects) if (graph.nodes[objectId]?.kind !== 'object') throw new Error(`Unknown generation creative object: ${objectId}`);
  const requestedContextIds = [...new Set([...sources, ...objects])];
  if (requestedContextIds.length > MAX_GENERATION_CONTEXT_IDS) throw new Error(`Generation model context exceeds ${MAX_GENERATION_CONTEXT_IDS} ids`);
  const sourceGraph = createPlannerSnapshot(graph, { focusNodeIds: requestedContextIds, neighborDepth: 0, maxNodes: requestedContextIds.length + 1 });
  for (const objectId of objects) if (!sourceGraph.nodes[objectId]) throw new Error(`Creative object ${objectId} does not permit model access`);
  for (const sourceId of sources) if (graph.nodes[sourceId]?.kind === 'object' && !sourceGraph.nodes[sourceId]) throw new Error(`Creative object ${sourceId} does not permit model access`);
  const cleanIntent = normalizeGenerationIntent(intent);
  const cleanSettings = normalizeBoundedModelJsonObject(settings, 'Generation settings', { maxBytes: MAX_GENERATION_RECORD_BYTES });
  const cleanPolicy = normalizeBoundedModelJsonObject(policy, 'Generation model policy', { maxBytes: MAX_GENERATION_MODEL_OPTIONS_BYTES });
  const cleanCallerContext = normalizeBoundedModelJsonObject(context, 'Generation model context', { maxBytes: MAX_GENERATION_MODEL_OPTIONS_BYTES });
  const cleanParentPlanId = optionalGenerationId(parentPlanId, 'Generation parentPlanId');
  const cleanRequestId = optionalGenerationId(requestId, 'Generation requestId');
  const cleanContext = normalizeBoundedModelJsonObject({ ...cleanCallerContext, parentPlanId: cleanParentPlanId, requestId: cleanRequestId }, 'Generation model context', { maxBytes: MAX_GENERATION_MODEL_OPTIONS_BYTES });
  const cleanModelInput = normalizeBoundedModelInput(modelInput, 'Generation model input', { maxBytes: MAX_GENERATION_MODEL_INPUT_BYTES });
  const routed = await router.execute(operation, {
    intent: cleanIntent,
    settings: cleanSettings,
    sourceGraph,
    input: cleanModelInput,
  }, { signal, policy: cleanPolicy, context: cleanContext });
  const modelResult = assertGeneratedModelResult(routed.output);
  const generation = createGenerationRecord({
    operation,
    backendId: routed.backendId,
    requestId: cleanRequestId,
    intent: cleanIntent,
    settings: cleanSettings,
    parentPlanId: cleanParentPlanId,
    sourceNodeIds: sources,
    metadata: {
      ...(modelResult.metadata ? cloneJson(modelResult.metadata, 'Generated model metadata') : {}),
      routing: { attempts: routed.attempts.slice(0, 32) },
    },
  });
  const materialized = createGeneratedAssetOperations(graph, { artifact: modelResult.artifact, generation, sourceNodeIds: sources, creativeObjectIds: objects });
  return {
    backendId: routed.backendId,
    attempts: routed.attempts,
    artifact: cloneJson(modelResult.artifact, 'Generated artifact descriptor'),
    payload: modelResult.payload,
    generation,
    asset: materialized.asset,
    operations: materialized.operations,
  };
}
