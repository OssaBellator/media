import { createEdge, createNode, edgesFrom, edgesTo, nodesByKind } from './graph.js';
import { createId } from './id.js';
import { canonicalOperationLogJson } from './operation-log.js';

export const CREATIVE_OBJECT_SCHEMA = 'media.creative-object.v1';
export const CREATIVE_OBJECT_MODEL_ACCESS = Object.freeze(['full', 'metadata', 'none']);
const CREATIVE_OBJECT_MODEL_ACCESS_SET = new Set(CREATIVE_OBJECT_MODEL_ACCESS);

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}
function cloneJson(value, label) {
  try { return JSON.parse(canonicalOperationLogJson(value)); }
  catch (error) { throw new Error(`${label} must be JSON-safe: ${error.message}`, { cause: error }); }
}
function normalizeTags(tags = []) {
  if (!Array.isArray(tags)) throw new Error('Creative object tags must be an array');
  return [...new Set(tags.map((tag) => requireString(tag, 'Creative object tag')))];
}
function normalizePermissions(value = {}) {
  const permissions = cloneJson(value, 'Creative object permissions');
  const modelAccess = permissions.modelAccess ?? 'full';
  if (!CREATIVE_OBJECT_MODEL_ACCESS_SET.has(modelAccess)) throw new Error(`Unsupported creative object modelAccess: ${modelAccess}`);
  return { ...permissions, modelAccess };
}
function normalizeConfidence(value) {
  if (value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error('Creative object confidence must be between 0 and 1');
  return number;
}
function requireCreativeObject(graph, objectId) {
  const object = graph?.nodes?.[objectId];
  if (!object || object.kind !== 'object') throw new Error(`Unknown creative object: ${objectId}`);
  return object;
}

export function createCreativeObject({
  id = createId('object'),
  name,
  objectType,
  semanticId = null,
  confidence = null,
  tags = [],
  semantics = {},
  provenance = {},
  permissions = {},
  generationHistory = [],
  attributes = {},
  now,
} = {}) {
  const type = requireString(objectType, 'Creative object type');
  if (semanticId != null) requireString(String(semanticId), 'Creative object semanticId');
  if (!Array.isArray(generationHistory)) throw new Error('Creative object generationHistory must be an array');
  return createNode({
    id,
    kind: 'object',
    name: name || type,
    now,
    props: {
      creativeObjectSchema: CREATIVE_OBJECT_SCHEMA,
      objectType: type,
      semanticId: semanticId == null ? null : String(semanticId),
      confidence: normalizeConfidence(confidence),
      tags: normalizeTags(tags),
      semantics: cloneJson(semantics, 'Creative object semantics'),
      provenance: cloneJson(provenance, 'Creative object provenance'),
      permissions: normalizePermissions(permissions),
      generationHistory: cloneJson(generationHistory, 'Creative object generationHistory'),
      attributes: cloneJson(attributes, 'Creative object attributes'),
    },
  });
}

export function createCreativeObjectOperations(graph, options = {}) {
  const { parentId = graph.projectId, ...objectOptions } = options;
  const parent = graph.nodes[parentId];
  if (!parent || !['project', 'object'].includes(parent.kind)) throw new Error('Creative object parent must be the project or another creative object');
  const object = createCreativeObject(objectOptions);
  return [
    { type: 'node.add', node: object },
    { type: 'edge.add', edge: createEdge({ from: parentId, to: object.id, type: 'contains', props: { role: 'creative-object' } }) },
  ];
}

export function updateCreativeObjectOperations(graph, objectId, patch = {}) {
  const object = requireCreativeObject(graph, objectId);
  const props = { ...object.props };
  if (patch.objectType !== undefined) props.objectType = requireString(patch.objectType, 'Creative object type');
  if (patch.semanticId !== undefined) props.semanticId = patch.semanticId == null ? null : requireString(String(patch.semanticId), 'Creative object semanticId');
  if (patch.confidence !== undefined) props.confidence = normalizeConfidence(patch.confidence);
  if (patch.tags !== undefined) props.tags = normalizeTags(patch.tags);
  for (const key of ['semantics', 'provenance', 'attributes']) {
    if (patch[key] !== undefined) props[key] = { ...(object.props[key] ?? {}), ...cloneJson(patch[key], `Creative object ${key}`) };
  }
  if (patch.permissions !== undefined) props.permissions = normalizePermissions({ ...(object.props.permissions ?? {}), ...cloneJson(patch.permissions, 'Creative object permissions') });
  if (patch.generationHistory !== undefined) {
    if (!Array.isArray(patch.generationHistory)) throw new Error('Creative object generationHistory must be an array');
    props.generationHistory = cloneJson(patch.generationHistory, 'Creative object generationHistory');
  }
  const nodePatch = { props };
  if (patch.name !== undefined) nodePatch.name = requireString(patch.name, 'Creative object name');
  return [{ type: 'node.update', nodeId: objectId, patch: nodePatch }];
}

export function appendCreativeObjectGenerationOperation(graph, objectId, event = {}) {
  const object = requireCreativeObject(graph, objectId);
  const clean = cloneJson(event, 'Creative object generation event');
  const entry = {
    id: clean.id ? requireString(clean.id, 'Creative object generation event id') : createId('generation'),
    at: clean.at ? requireString(clean.at, 'Creative object generation event time') : new Date().toISOString(),
    ...clean,
  };
  return [{ type: 'node.update', nodeId: objectId, patch: { props: { generationHistory: [...(object.props.generationHistory ?? []), entry] } } }];
}

export function linkCreativeObjectOperations(graph, objectId, targetId, {
  role = 'related',
  geometry = null,
  time = null,
  mask = null,
  tracking = null,
  transformations = [],
  metadata = {},
} = {}) {
  requireCreativeObject(graph, objectId);
  if (!graph.nodes[targetId]) throw new Error(`Unknown creative object relationship target: ${targetId}`);
  if (!Array.isArray(transformations)) throw new Error('Creative object relationship transformations must be an array');
  const props = {
    role: requireString(role, 'Creative object relationship role'),
    transformations: cloneJson(transformations, 'Creative object relationship transformations'),
    metadata: cloneJson(metadata, 'Creative object relationship metadata'),
  };
  for (const [key, value] of Object.entries({ geometry, time, mask, tracking })) if (value != null) props[key] = cloneJson(value, `Creative object relationship ${key}`);
  return [{ type: 'edge.add', edge: createEdge({ from: objectId, to: targetId, type: 'relates-to', props }) }];
}

export function creativeObjectRelationships(graph, objectId, { role = null } = {}) {
  requireCreativeObject(graph, objectId);
  return edgesFrom(graph, objectId, 'relates-to').filter((edge) => !role || edge.props?.role === role);
}

export function creativeObjectsForTarget(graph, targetId, { role = null } = {}) {
  if (!graph.nodes[targetId]) return [];
  return edgesTo(graph, targetId, 'relates-to')
    .filter((edge) => !role || edge.props?.role === role)
    .map((edge) => graph.nodes[edge.from])
    .filter((node) => node?.kind === 'object');
}

export function findCreativeObjects(graph, { objectType = null, semanticId = null, tag = null, name = null } = {}) {
  return nodesByKind(graph, 'object').filter((object) => {
    if (objectType && object.props.objectType !== objectType) return false;
    if (semanticId && object.props.semanticId !== semanticId) return false;
    if (tag && !(object.props.tags ?? []).includes(tag)) return false;
    if (name && !String(object.name).toLowerCase().includes(String(name).toLowerCase())) return false;
    return true;
  });
}
