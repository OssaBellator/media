import { createAgentPlan } from './agent-plan.js';
import { assetReplacementConsumers, createAssetReplacementOperations } from './asset-replacement.js';
import { creativeObjectRelationships } from './creative-object.js';
import { applyOperations } from './operations.js';

export const CREATIVE_OBJECT_RESTYLE_SCHEMA = 'media.creative-object-restyle.v1';
export const MAX_CREATIVE_OBJECT_RESTYLE_REPRESENTATIONS = 64;

function requireCreativeObject(graph, objectId) {
  const object = graph?.nodes?.[objectId];
  if (!object || object.kind !== 'object') throw new Error(`Unknown creative object: ${objectId}`);
  return object;
}
function boundedRepresentationLimit(value) {
  const number = Math.floor(Number(value) || MAX_CREATIVE_OBJECT_RESTYLE_REPRESENTATIONS);
  return Math.max(1, Math.min(MAX_CREATIVE_OBJECT_RESTYLE_REPRESENTATIONS, number));
}
function representationAssetId(graph, target) {
  if (!target) return null;
  if (target.kind === 'asset') return target.id;
  if (target.kind === 'clip' || target.kind === 'layer') {
    const assetId = target.props?.assetId;
    return graph.nodes?.[assetId]?.kind === 'asset' ? assetId : null;
  }
  return null;
}
function uniqueSorted(values) {
  return [...new Set(values)].sort();
}
function generationHistoryEntry(replacement) {
  const generation = replacement.generation;
  return {
    id: generation.id,
    at: generation.createdAt,
    type: 'generated-media',
    operation: generation.operation,
    backendId: generation.backendId,
    artifactId: replacement.asset.id,
    parentPlanId: generation.parentPlanId ?? null,
  };
}
function stripCreativeObjectHistoryUpdate(operations, objectId) {
  const kept = [];
  let historyUpdates = 0;
  for (const operation of operations) {
    if (operation.type === 'node.update' && operation.nodeId === objectId) {
      const propKeys = Object.keys(operation.patch?.props ?? {});
      const patchKeys = Object.keys(operation.patch ?? {});
      if (patchKeys.length === 1 && propKeys.length === 1 && propKeys[0] === 'generationHistory') {
        historyUpdates += 1;
        continue;
      }
      throw new Error('Generated restyle operations may not mutate the Creative Object outside generationHistory');
    }
    if (!['node.add', 'edge.add'].includes(operation.type)) throw new Error(`Generated restyle operation is not additive: ${operation.type}`);
    kept.push(operation);
  }
  if (historyUpdates !== 1) throw new Error('Generated restyle operations must contain exactly one Creative Object generationHistory update');
  return kept;
}
function assertGeneratedReplacement(cursor, objectId, representation, replacement) {
  if (!replacement || typeof replacement !== 'object') throw new Error(`Missing restyle replacement for ${representation.assetId}`);
  if (replacement.sourceAssetId !== representation.assetId) throw new Error(`Restyle replacement source mismatch for ${representation.assetId}`);
  if (!replacement.asset || replacement.asset.kind !== 'asset') throw new Error(`Restyle replacement for ${representation.assetId} requires a generated asset`);
  if (!replacement.generation || typeof replacement.generation !== 'object') throw new Error(`Restyle replacement for ${representation.assetId} requires generation provenance`);
  if (!Array.isArray(replacement.operations)) throw new Error(`Restyle replacement for ${representation.assetId} requires generated operations`);
  const expectedOperation = restyleOperationForAsset(cursor.nodes[representation.assetId]);
  if (replacement.generation.operation !== expectedOperation) throw new Error(`Restyle generation operation ${replacement.generation.operation} does not match ${expectedOperation}`);
  if (!(replacement.generation.sourceNodeIds ?? []).includes(representation.assetId)) throw new Error(`Restyle generation for ${representation.assetId} must retain the source asset`);
}
function assertGeneratedProvenance(graph, objectId, sourceAssetId, generatedAssetId) {
  const objectLink = Object.values(graph.edges ?? {}).some((edge) => edge.type === 'relates-to' && edge.from === objectId && edge.to === generatedAssetId && edge.props?.role === 'generated-representation');
  if (!objectLink) throw new Error(`Generated restyle asset ${generatedAssetId} is not linked to Creative Object ${objectId}`);
  const sourceLink = Object.values(graph.edges ?? {}).some((edge) => edge.type === 'derives-from' && edge.from === generatedAssetId && edge.to === sourceAssetId);
  if (!sourceLink) throw new Error(`Generated restyle asset ${generatedAssetId} does not derive from ${sourceAssetId}`);
}

export function resolveCreativeObjectRepresentations(graph, objectId, { maxRepresentations = MAX_CREATIVE_OBJECT_RESTYLE_REPRESENTATIONS } = {}) {
  requireCreativeObject(graph, objectId);
  const limit = boundedRepresentationLimit(maxRepresentations);
  const byAsset = new Map();
  for (const edge of creativeObjectRelationships(graph, objectId)) {
    const target = graph.nodes[edge.to];
    const assetId = representationAssetId(graph, target);
    if (!assetId) continue;
    let representation = byAsset.get(assetId);
    if (!representation) {
      const asset = graph.nodes[assetId];
      representation = {
        assetId,
        assetName: asset.name,
        mediaKind: asset.props?.mediaKind ?? null,
        relationshipIds: [],
        relationshipTargetIds: [],
        relationshipRoles: [],
        consumerNodeIds: assetReplacementConsumers(graph, assetId).map((node) => node.id),
      };
      byAsset.set(assetId, representation);
    }
    representation.relationshipIds.push(edge.id);
    representation.relationshipTargetIds.push(edge.to);
    representation.relationshipRoles.push(String(edge.props?.role ?? 'related'));
  }
  const representations = [...byAsset.values()].map((entry) => ({
    ...entry,
    relationshipIds: uniqueSorted(entry.relationshipIds),
    relationshipTargetIds: uniqueSorted(entry.relationshipTargetIds),
    relationshipRoles: uniqueSorted(entry.relationshipRoles),
  })).sort((a, b) => a.assetId.localeCompare(b.assetId));
  if (representations.length > limit) throw new Error(`Creative Object restyle resolves ${representations.length} representations, exceeding limit ${limit}`);
  return representations;
}

export function restyleOperationForAsset(asset) {
  if (!asset || asset.kind !== 'asset') throw new Error('Restyle source must be an asset');
  const mediaKind = asset.props?.mediaKind;
  if (mediaKind === 'image') return 'edit-image';
  if (mediaKind === 'video') return 'edit-video';
  if (mediaKind === 'audio' || mediaKind === 'music') return 'edit-audio';
  throw new Error(`Creative Object restyle does not support media kind: ${mediaKind ?? 'unknown'}`);
}

export function materializeCreativeObjectRestyleOperations(graph, {
  objectId,
  replacements = [],
  maxRepresentations = MAX_CREATIVE_OBJECT_RESTYLE_REPRESENTATIONS,
} = {}) {
  const object = requireCreativeObject(graph, objectId);
  if (!Array.isArray(replacements)) throw new Error('Creative Object restyle replacements must be an array');
  const representations = resolveCreativeObjectRepresentations(graph, objectId, { maxRepresentations });
  if (!representations.length) throw new Error(`Creative Object ${objectId} has no media representations to restyle`);
  const replacementBySource = new Map();
  for (const replacement of replacements) {
    const sourceAssetId = String(replacement?.sourceAssetId ?? '');
    if (!sourceAssetId) throw new Error('Creative Object restyle replacement requires sourceAssetId');
    if (replacementBySource.has(sourceAssetId)) throw new Error(`Duplicate Creative Object restyle replacement for ${sourceAssetId}`);
    replacementBySource.set(sourceAssetId, replacement);
  }
  const expected = new Set(representations.map((entry) => entry.assetId));
  for (const sourceAssetId of replacementBySource.keys()) if (!expected.has(sourceAssetId)) throw new Error(`Restyle replacement source is not a representation of ${objectId}: ${sourceAssetId}`);
  if (replacementBySource.size !== expected.size) throw new Error(`Creative Object restyle requires one replacement for each of ${expected.size} representations`);

  let cursor = graph;
  const operations = [];
  const summaries = [];
  const history = [...(object.props?.generationHistory ?? [])];
  for (const representation of representations) {
    const replacement = replacementBySource.get(representation.assetId);
    assertGeneratedReplacement(cursor, objectId, representation, replacement);
    const additive = stripCreativeObjectHistoryUpdate(replacement.operations, objectId);
    operations.push(...additive);
    cursor = applyOperations(cursor, additive);
    if (cursor.nodes[replacement.asset.id]?.kind !== 'asset') throw new Error(`Generated restyle asset was not materialized: ${replacement.asset.id}`);
    assertGeneratedProvenance(cursor, objectId, representation.assetId, replacement.asset.id);
    const rewires = createAssetReplacementOperations(cursor, {
      sourceAssetId: representation.assetId,
      replacementAssetId: replacement.asset.id,
      consumerNodeIds: representation.consumerNodeIds,
    });
    operations.push(...rewires);
    cursor = applyOperations(cursor, rewires);
    const event = generationHistoryEntry(replacement);
    history.push(event);
    summaries.push({
      sourceAssetId: representation.assetId,
      replacementAssetId: replacement.asset.id,
      generationId: replacement.generation.id,
      operation: replacement.generation.operation,
      consumerNodeIds: [...representation.consumerNodeIds],
    });
  }
  const historyOperation = { type: 'node.update', nodeId: objectId, patch: { props: { generationHistory: history } } };
  operations.push(historyOperation);
  cursor = applyOperations(cursor, [historyOperation]);
  return { objectId, representations, replacements: summaries, operations, graph: cursor };
}

export function createCreativeObjectRestylePlan(graph, {
  id,
  objectId,
  intent,
  replacements = [],
  providerId = 'model-router',
  providerLabel = 'Model router',
  metadata = {},
  maxRepresentations = MAX_CREATIVE_OBJECT_RESTYLE_REPRESENTATIONS,
} = {}) {
  const materialized = materializeCreativeObjectRestyleOperations(graph, { objectId, replacements, maxRepresentations });
  const object = graph.nodes[objectId];
  const plan = createAgentPlan(graph, {
    ...(id ? { id } : {}),
    intent,
    summary: `Restyle ${object.name} across ${materialized.representations.length} representation${materialized.representations.length === 1 ? '' : 's'}`,
    operations: materialized.operations,
    providerId,
    providerLabel,
    metadata: {
      ...metadata,
      creativeObjectRestyle: {
        schema: CREATIVE_OBJECT_RESTYLE_SCHEMA,
        objectId,
        atomic: true,
        replacements: materialized.replacements.map(({ consumerNodeIds, ...replacement }) => ({ ...replacement, consumerCount: consumerNodeIds.length })),
      },
    },
  });
  return { ...materialized, plan };
}
