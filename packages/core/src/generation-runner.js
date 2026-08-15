import { canonicalOperationLogJson } from './operation-log.js';
import { createGeneratedAssetOperations, createGenerationRecord, GENERATED_MEDIA_OPERATIONS } from './generated-media.js';
import { createPlannerSnapshot } from './providers.js';

const GENERATED_OPERATION_SET = new Set(GENERATED_MEDIA_OPERATIONS);

function cloneJson(value, label) {
  try { return JSON.parse(canonicalOperationLogJson(value)); }
  catch (error) { throw new Error(`${label} must be JSON-safe: ${error.message}`, { cause: error }); }
}
function uniqueIds(values, label) {
  if (!Array.isArray(values)) throw new Error(`${label} must be an array`);
  return [...new Set(values.map((value) => {
    const id = String(value ?? '').trim();
    if (!id) throw new Error(`${label} must contain non-empty ids`);
    return id;
  }))];
}

export function assertGeneratedModelResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Generated model result must be an object');
  if (!result.artifact || typeof result.artifact !== 'object' || Array.isArray(result.artifact)) throw new Error('Generated model result requires an artifact descriptor');
  if (typeof result.artifact.name !== 'string' || !result.artifact.name.trim()) throw new Error('Generated artifact requires a name');
  if (typeof result.artifact.mimeType !== 'string' || !result.artifact.mimeType.trim()) throw new Error('Generated artifact requires a mimeType');
  if (result.metadata !== undefined && (!result.metadata || typeof result.metadata !== 'object' || Array.isArray(result.metadata))) throw new Error('Generated model metadata must be an object');
  cloneJson(result.artifact, 'Generated artifact descriptor');
  if (result.metadata !== undefined) cloneJson(result.metadata, 'Generated model metadata');
  return result;
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
  const sourceGraph = createPlannerSnapshot(graph, { focusNodeIds: requestedContextIds, neighborDepth: 0, maxNodes: requestedContextIds.length + 1 });
  for (const objectId of objects) if (!sourceGraph.nodes[objectId]) throw new Error(`Creative object ${objectId} does not permit model access`);
  for (const sourceId of sources) if (graph.nodes[sourceId]?.kind === 'object' && !sourceGraph.nodes[sourceId]) throw new Error(`Creative object ${sourceId} does not permit model access`);
  const cleanSettings = cloneJson(settings, 'Generation settings');
  const routed = await router.execute(operation, {
    intent: String(intent ?? ''),
    settings: cleanSettings,
    sourceGraph,
    input: modelInput,
  }, { signal, policy, context: { ...context, parentPlanId, requestId } });
  const modelResult = assertGeneratedModelResult(routed.output);
  const generation = createGenerationRecord({
    operation,
    backendId: routed.backendId,
    requestId,
    intent,
    settings: cleanSettings,
    parentPlanId,
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
