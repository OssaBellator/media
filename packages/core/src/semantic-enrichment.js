import { canonicalOperationLogJson } from './operation-log.js';
import { applyOperations } from './operations.js';
import {
  createCreativeObjectOperations,
  findCreativeObjects,
  linkCreativeObjectOperations,
  updateCreativeObjectOperations,
} from './creative-object.js';
import { DEFAULT_MODEL_INPUT_BYTES, DEFAULT_MODEL_OPTIONS_BYTES, normalizeBoundedModelInput, normalizeBoundedModelJsonObject } from './model-input.js';
import { createPlannerSnapshot } from './providers.js';

export const SEMANTIC_ENRICHMENT_SCHEMA = 'media.semantic-enrichment.v1';
export const MAX_SEMANTIC_ENRICHMENT_OBJECTS = 1024;
export const MAX_SEMANTIC_ENRICHMENT_RELATIONSHIPS = 4096;
export const MAX_SEMANTIC_ENRICHMENT_BYTES = 2 * 1024 * 1024;
export const MAX_SEMANTIC_MODEL_SOURCE_IDS = 1024;
export const MAX_SEMANTIC_MODEL_SOURCE_ID_CHARS = 512;
export const MAX_SEMANTIC_MODEL_INPUT_BYTES = DEFAULT_MODEL_INPUT_BYTES;
export const MAX_SEMANTIC_MODEL_OPTIONS_BYTES = DEFAULT_MODEL_OPTIONS_BYTES;

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}
function cloneJson(value, label) {
  try { return JSON.parse(canonicalOperationLogJson(value)); }
  catch (error) { throw new Error(`${label} must be JSON-safe: ${error.message}`, { cause: error }); }
}
function utf8Bytes(value) { return new TextEncoder().encode(value).byteLength; }
function normalizePermissions(value = {}) {
  const clean = normalizeBoundedModelJsonObject(value, 'Semantic enrichment permissions', { maxBytes: MAX_SEMANTIC_MODEL_OPTIONS_BYTES });
  const access = clean.modelAccess ?? 'full';
  if (!['full', 'metadata', 'none'].includes(access)) throw new Error(`Unsupported semantic enrichment modelAccess: ${access}`);
  return { ...clean, modelAccess: access };
}
function normalizeModelSourceIds(values) {
  if (!Array.isArray(values)) throw new Error('Semantic enrichment sourceNodeIds must be an array');
  if (values.length > MAX_SEMANTIC_MODEL_SOURCE_IDS) throw new Error(`Semantic enrichment sourceNodeIds exceeds ${MAX_SEMANTIC_MODEL_SOURCE_IDS} ids`);
  return [...new Set(values.map((value) => {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Semantic enrichment source id must be a non-empty string');
    const id = value.trim();
    if (id.length > MAX_SEMANTIC_MODEL_SOURCE_ID_CHARS) throw new Error(`Semantic enrichment source id exceeds ${MAX_SEMANTIC_MODEL_SOURCE_ID_CHARS} characters`);
    return id;
  }))];
}

export function assertSemanticEnrichment(result, { maxBytes = MAX_SEMANTIC_ENRICHMENT_BYTES } = {}) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Semantic enrichment must be an object');
  const limit = Math.max(1024, Math.floor(Number(maxBytes) || MAX_SEMANTIC_ENRICHMENT_BYTES));
  const clean = normalizeBoundedModelJsonObject(result, 'Semantic enrichment', { maxBytes: limit });
  if (clean.schema !== undefined && clean.schema !== SEMANTIC_ENRICHMENT_SCHEMA) throw new Error(`Unsupported semantic enrichment schema: ${clean.schema}`);
  if (!Array.isArray(clean.objects)) throw new Error('Semantic enrichment requires an objects array');
  if (clean.objects.length > MAX_SEMANTIC_ENRICHMENT_OBJECTS) throw new Error(`Semantic enrichment exceeds ${MAX_SEMANTIC_ENRICHMENT_OBJECTS} objects`);
  let relationshipCount = 0;
  for (const [index, object] of clean.objects.entries()) {
    if (!object || typeof object !== 'object' || Array.isArray(object)) throw new Error(`Semantic enrichment object ${index} must be an object`);
    requireString(object.name ?? object.objectType, `Semantic enrichment object ${index} name`);
    requireString(object.objectType, `Semantic enrichment object ${index} type`);
    if (object.semanticId != null) requireString(String(object.semanticId), `Semantic enrichment object ${index} semanticId`);
    if (object.provenance !== undefined && (!object.provenance || typeof object.provenance !== 'object' || Array.isArray(object.provenance))) throw new Error(`Semantic enrichment object ${index} provenance must be an object`);
    if (object.relationships !== undefined && !Array.isArray(object.relationships)) throw new Error(`Semantic enrichment object ${index} relationships must be an array`);
    relationshipCount += object.relationships?.length ?? 0;
  }
  if (relationshipCount > MAX_SEMANTIC_ENRICHMENT_RELATIONSHIPS) throw new Error(`Semantic enrichment exceeds ${MAX_SEMANTIC_ENRICHMENT_RELATIONSHIPS} relationships`);
  const canonical = canonicalOperationLogJson({ schema: SEMANTIC_ENRICHMENT_SCHEMA, objects: clean.objects });
  if (utf8Bytes(canonical) > limit) throw new Error(`Semantic enrichment exceeds ${limit} bytes`);
  return JSON.parse(canonical);
}

function existingObjectForEntry(graph, entry) {
  if (!entry.semanticId) return null;
  const matches = findCreativeObjects(graph, { semanticId: String(entry.semanticId) });
  if (matches.length > 1) throw new Error(`Semantic enrichment identity is ambiguous: ${entry.semanticId}`);
  if (matches[0] && matches[0].props.objectType !== entry.objectType) throw new Error(`Semantic enrichment identity type mismatch for ${entry.semanticId}`);
  return matches[0] ?? null;
}
function relationTargetId(graph, relation, semanticIds) {
  if (relation.targetId != null) {
    const id = requireString(String(relation.targetId), 'Semantic enrichment relationship targetId');
    if (!graph.nodes[id]) throw new Error(`Unknown semantic enrichment relationship target: ${id}`);
    return id;
  }
  if (relation.targetSemanticId != null) {
    const semanticId = requireString(String(relation.targetSemanticId), 'Semantic enrichment relationship targetSemanticId');
    const id = semanticIds.get(semanticId);
    if (!id) throw new Error(`Unknown semantic enrichment semantic target: ${semanticId}`);
    return id;
  }
  throw new Error('Semantic enrichment relationship requires targetId or targetSemanticId');
}
function sameRelation(edge, targetId, role) {
  return edge.type === 'relates-to' && edge.to === targetId && edge.props?.role === role;
}

export function createSemanticEnrichmentOperations(graph, enrichment, {
  parentId = graph.projectId,
  permissions = { modelAccess: 'full' },
  provenance = {},
} = {}) {
  const normalized = assertSemanticEnrichment(enrichment);
  const safePermissions = normalizePermissions(permissions);
  const safeProvenance = cloneJson(provenance, 'Semantic enrichment provenance');
  let cursor = graph;
  const operations = [];
  const semanticIds = new Map();
  const objectIds = [];

  for (const entry of normalized.objects) {
    const existing = existingObjectForEntry(cursor, entry);
    let objectId;
    if (existing) {
      objectId = existing.id;
      const update = updateCreativeObjectOperations(cursor, existing.id, {
        ...(entry.name != null ? { name: entry.name } : {}),
        ...(entry.confidence !== undefined ? { confidence: entry.confidence } : {}),
        ...(entry.tags !== undefined ? { tags: entry.tags } : {}),
        ...(entry.semantics !== undefined ? { semantics: entry.semantics } : {}),
        ...(entry.attributes !== undefined ? { attributes: entry.attributes } : {}),
        provenance: { ...(entry.provenance ?? {}), ...safeProvenance },
      });
      operations.push(...update);
      cursor = applyOperations(cursor, update);
    } else {
      const create = createCreativeObjectOperations(cursor, {
        parentId,
        name: entry.name ?? entry.objectType,
        objectType: entry.objectType,
        semanticId: entry.semanticId ?? null,
        confidence: entry.confidence ?? null,
        tags: entry.tags ?? [],
        semantics: entry.semantics ?? {},
        attributes: entry.attributes ?? {},
        provenance: { ...(entry.provenance ?? {}), ...safeProvenance },
        permissions: safePermissions,
      });
      objectId = create[0].node.id;
      operations.push(...create);
      cursor = applyOperations(cursor, create);
    }
    objectIds.push(objectId);
    if (entry.semanticId != null) {
      const semanticId = String(entry.semanticId);
      const previous = semanticIds.get(semanticId);
      if (previous && previous !== objectId) throw new Error(`Semantic enrichment duplicates semanticId: ${semanticId}`);
      semanticIds.set(semanticId, objectId);
    }
  }

  for (let index = 0; index < normalized.objects.length; index += 1) {
    const entry = normalized.objects[index];
    const objectId = objectIds[index];
    for (const relation of entry.relationships ?? []) {
      if (!relation || typeof relation !== 'object' || Array.isArray(relation)) throw new Error(`Semantic enrichment relationship for ${objectId} must be an object`);
      const role = requireString(relation.role, 'Semantic enrichment relationship role');
      const targetId = relationTargetId(cursor, relation, semanticIds);
      const existing = Object.values(cursor.edges).find((edge) => edge.from === objectId && sameRelation(edge, targetId, role));
      const link = linkCreativeObjectOperations(cursor, objectId, targetId, {
        role,
        geometry: relation.geometry ?? null,
        time: relation.time ?? null,
        mask: relation.mask ?? null,
        tracking: relation.tracking ?? null,
        transformations: relation.transformations ?? [],
        metadata: relation.metadata ?? {},
      });
      let delta = link;
      if (existing) {
        const candidate = link[0].edge;
        if (canonicalOperationLogJson(existing.props ?? {}) === canonicalOperationLogJson(candidate.props ?? {})) continue;
        delta = [{ type: 'edge.remove', edgeId: existing.id }, { type: 'edge.add', edge: { ...candidate, id: existing.id } }];
      }
      operations.push(...delta);
      cursor = applyOperations(cursor, delta);
    }
  }
  return { operations, objectIds, graph: cursor };
}

export async function runSemanticEnrichmentModel(router, graph, {
  sourceNodeIds = [],
  modelInput = {},
  policy = {},
  context = {},
  permissions = { modelAccess: 'full' },
  signal,
} = {}) {
  if (!router || typeof router.execute !== 'function') throw new Error('Semantic enrichment requires a model router');
  const sources = normalizeModelSourceIds(sourceNodeIds);
  for (const id of sources) if (!graph.nodes[id]) throw new Error(`Unknown semantic enrichment source node: ${id}`);
  const sourceGraph = createPlannerSnapshot(graph, { focusNodeIds: sources, neighborDepth: 0, maxNodes: sources.length + 1 });
  for (const id of sources) if (graph.nodes[id]?.kind === 'object' && !sourceGraph.nodes[id]) throw new Error(`Creative object ${id} does not permit model access`);
  const cleanModelInput = normalizeBoundedModelInput(modelInput, 'Semantic enrichment model input', { maxBytes: MAX_SEMANTIC_MODEL_INPUT_BYTES });
  const cleanPolicy = normalizeBoundedModelJsonObject(policy, 'Semantic enrichment model policy', { maxBytes: MAX_SEMANTIC_MODEL_OPTIONS_BYTES });
  const cleanContext = normalizeBoundedModelJsonObject(context, 'Semantic enrichment model context', { maxBytes: MAX_SEMANTIC_MODEL_OPTIONS_BYTES });
  const cleanPermissions = normalizePermissions(permissions);
  const routed = await router.execute('analyze-media', { sourceGraph, input: cleanModelInput }, { signal, policy: cleanPolicy, context: cleanContext });
  const enrichment = assertSemanticEnrichment(routed.output);
  const materialized = createSemanticEnrichmentOperations(graph, enrichment, {
    permissions: cleanPermissions,
    provenance: { source: 'model-analysis', backendId: routed.backendId, sourceNodeIds: sources },
  });
  return { backendId: routed.backendId, attempts: routed.attempts, enrichment, ...materialized };
}
