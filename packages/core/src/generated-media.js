import { createEdge, edgesFrom, edgesTo } from './graph.js';
import { createId } from './id.js';
import { canonicalOperationLogJson } from './operation-log.js';
import { createAsset } from './project.js';

export const GENERATION_RECORD_SCHEMA = 'media.generation-record.v1';
export const GENERATED_MEDIA_OPERATIONS = Object.freeze(['generate-image', 'edit-image', 'generate-video', 'edit-video', 'generate-audio', 'edit-audio', 'synthesize-speech']);
export const MAX_GENERATION_RECORD_BYTES = 64 * 1024;
export const MAX_GENERATION_INTENT_CHARS = 16 * 1024;
const GENERATED_MEDIA_OPERATION_SET = new Set(GENERATED_MEDIA_OPERATIONS);

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}
function cloneJson(value, label) {
  try { return JSON.parse(canonicalOperationLogJson(value)); }
  catch (error) { throw new Error(`${label} must be JSON-safe: ${error.message}`, { cause: error }); }
}
function utf8Bytes(text) { return new TextEncoder().encode(text).byteLength; }
function expectedMediaKind(operation) {
  if (operation.includes('image')) return 'image';
  if (operation.includes('video')) return 'video';
  return 'audio';
}

export function assertGenerationRecord(record, { maxBytes = MAX_GENERATION_RECORD_BYTES } = {}) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Generation record must be an object');
  if (record.schema !== GENERATION_RECORD_SCHEMA) throw new Error(`Unsupported generation record schema: ${record.schema}`);
  requireString(record.id, 'Generation id');
  const operation = requireString(record.operation, 'Generation operation');
  if (!GENERATED_MEDIA_OPERATION_SET.has(operation)) throw new Error(`Unsupported generated media operation: ${operation}`);
  requireString(record.backendId, 'Generation backendId');
  if (record.requestId != null) requireString(record.requestId, 'Generation requestId');
  if (typeof record.intent !== 'string') throw new Error('Generation intent must be a string');
  if (record.intent.length > MAX_GENERATION_INTENT_CHARS) throw new Error(`Generation intent exceeds ${MAX_GENERATION_INTENT_CHARS} characters`);
  if (!record.settings || typeof record.settings !== 'object' || Array.isArray(record.settings)) throw new Error('Generation settings must be an object');
  if (record.parentPlanId != null) requireString(record.parentPlanId, 'Generation parentPlanId');
  if (!Array.isArray(record.sourceNodeIds) || record.sourceNodeIds.some((id) => typeof id !== 'string' || !id)) throw new Error('Generation sourceNodeIds must contain non-empty strings');
  if (new Set(record.sourceNodeIds).size !== record.sourceNodeIds.length) throw new Error('Generation sourceNodeIds must be unique');
  requireString(record.createdAt, 'Generation createdAt');
  if (!record.metadata || typeof record.metadata !== 'object' || Array.isArray(record.metadata)) throw new Error('Generation metadata must be an object');
  const canonical = canonicalOperationLogJson(record);
  const limit = Math.max(1024, Math.floor(Number(maxBytes) || MAX_GENERATION_RECORD_BYTES));
  if (utf8Bytes(canonical) > limit) throw new Error(`Generation record exceeds ${limit} bytes`);
  return record;
}

export function createGenerationRecord({
  id = createId('generation'),
  operation,
  backendId,
  requestId = null,
  intent = '',
  settings = {},
  parentPlanId = null,
  sourceNodeIds = [],
  createdAt = new Date().toISOString(),
  metadata = {},
} = {}) {
  const cleanOperation = requireString(operation, 'Generation operation');
  if (!GENERATED_MEDIA_OPERATION_SET.has(cleanOperation)) throw new Error(`Unsupported generated media operation: ${cleanOperation}`);
  if (!Array.isArray(sourceNodeIds)) throw new Error('Generation sourceNodeIds must be an array');
  const record = {
    schema: GENERATION_RECORD_SCHEMA,
    id: requireString(id, 'Generation id'),
    operation: cleanOperation,
    backendId: requireString(backendId, 'Generation backendId'),
    requestId: requestId == null ? null : requireString(requestId, 'Generation requestId'),
    intent: String(intent ?? ''),
    settings: cloneJson(settings, 'Generation settings'),
    parentPlanId: parentPlanId == null ? null : requireString(parentPlanId, 'Generation parentPlanId'),
    sourceNodeIds: [...new Set(sourceNodeIds.map((value) => requireString(String(value), 'Generation source node id')))],
    createdAt: requireString(createdAt, 'Generation createdAt'),
    metadata: cloneJson(metadata, 'Generation metadata'),
  };
  return assertGenerationRecord(record);
}

export function createGeneratedAssetOperations(graph, {
  artifact,
  generation,
  sourceNodeIds = generation?.sourceNodeIds ?? [],
  creativeObjectIds = [],
} = {}) {
  if (!artifact || typeof artifact !== 'object') throw new Error('Generated media requires an artifact descriptor');
  assertGenerationRecord(generation);
  if (!Array.isArray(sourceNodeIds) || !Array.isArray(creativeObjectIds)) throw new Error('Generated media source/object ids must be arrays');
  const sources = [...new Set(sourceNodeIds.map((value) => requireString(String(value), 'Generation source node id')))];
  for (const sourceId of sources) if (!graph.nodes[sourceId]) throw new Error(`Unknown generation source node: ${sourceId}`);
  const objects = [...new Set(creativeObjectIds.map((value) => requireString(String(value), 'Generation creative object id')))];
  for (const objectId of objects) if (graph.nodes[objectId]?.kind !== 'object') throw new Error(`Unknown generation creative object: ${objectId}`);
  const baseAsset = createAsset(artifact);
  if (baseAsset.props.mediaKind !== expectedMediaKind(generation.operation)) throw new Error(`Generated artifact media kind ${baseAsset.props.mediaKind} does not match ${generation.operation}`);
  const record = assertGenerationRecord({ ...cloneJson(generation, 'Generation record'), sourceNodeIds: sources });
  const asset = { ...baseAsset, props: { ...baseAsset.props, generated: true, generation: record } };
  const operations = [
    { type: 'node.add', node: asset },
    { type: 'edge.add', edge: createEdge({ from: graph.projectId, to: asset.id, type: 'contains', props: { role: 'generated-asset' } }) },
  ];
  for (const sourceId of sources) operations.push({ type: 'edge.add', edge: createEdge({ from: asset.id, to: sourceId, type: 'derives-from', props: { generationId: record.id } }) });
  for (const objectId of objects) {
    const object = graph.nodes[objectId];
    operations.push({ type: 'edge.add', edge: createEdge({ from: objectId, to: asset.id, type: 'relates-to', props: { role: 'generated-representation', transformations: [], metadata: { generationId: record.id } } }) });
    operations.push({ type: 'node.update', nodeId: objectId, patch: { props: { generationHistory: [...(object.props.generationHistory ?? []), { id: record.id, at: record.createdAt, type: 'generated-media', operation: record.operation, backendId: record.backendId, artifactId: asset.id, parentPlanId: record.parentPlanId }] } } });
  }
  return { asset, operations };
}

export function generatedAssetProvenance(graph, assetId) {
  const asset = graph?.nodes?.[assetId];
  if (!asset || asset.kind !== 'asset' || asset.props?.generated !== true) return null;
  try { assertGenerationRecord(asset.props?.generation); } catch { return null; }
  const sourceIds = edgesFrom(graph, assetId, 'derives-from').map((edge) => edge.to).sort();
  const creativeObjectIds = edgesTo(graph, assetId, 'relates-to').filter((edge) => edge.props?.role === 'generated-representation').map((edge) => edge.from).sort();
  return { assetId, generation: cloneJson(asset.props.generation, 'Stored generation record'), sourceNodeIds: sourceIds, creativeObjectIds };
}
