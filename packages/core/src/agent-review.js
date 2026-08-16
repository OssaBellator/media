import { applyOperation } from './operations.js';
import { assertAgentPlanMatchesGraph, inspectAgentPlan, previewAgentPlan } from './agent-plan.js';

function previewValue(value, depth = 0) {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.length <= 160 ? value : `${value.slice(0, 157)}…`;
  if (Array.isArray(value)) {
    if (depth >= 2 || value.length > 16) return { type: 'array', length: value.length };
    return value.map((item) => previewValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    if (depth >= 2 || keys.length > 16) return { type: 'object', keys: keys.slice(0, 16), keyCount: keys.length };
    return Object.fromEntries(keys.map((key) => [key, previewValue(value[key], depth + 1)]));
  }
  return String(value);
}
function nodeLabel(graph, nodeId) { return graph.nodes[nodeId]?.name ?? nodeId; }
function nodeSummary(node) { return node ? { id: node.id, kind: node.kind, name: node.name } : null; }
function updateChanges(node, patch = {}) {
  const changes = [];
  for (const [key, after] of Object.entries(patch)) {
    if (['id', 'kind', 'createdAt', 'updatedAt'].includes(key)) continue;
    if (key === 'props') {
      for (const [prop, propAfter] of Object.entries(after ?? {})) changes.push({ path: `props.${prop}`, before: previewValue(node?.props?.[prop]), after: previewValue(propAfter) });
    } else changes.push({ path: key, before: previewValue(node?.[key]), after: previewValue(after) });
  }
  return changes;
}
function reviewOperation(graph, operation, index) {
  switch (operation.type) {
    case 'node.add': return { index, type: operation.type, summary: `Add ${operation.node.kind} ${operation.node.name}`, entity: nodeSummary(operation.node), changes: [] };
    case 'node.update': {
      const node = graph.nodes[operation.nodeId];
      return { index, type: operation.type, summary: `Update ${nodeLabel(graph, operation.nodeId)}`, entity: nodeSummary(node), changes: updateChanges(node, operation.patch) };
    }
    case 'node.remove': {
      const node = graph.nodes[operation.nodeId];
      return { index, type: operation.type, summary: `Remove ${nodeLabel(graph, operation.nodeId)}`, entity: nodeSummary(node), changes: [] };
    }
    case 'edge.add': {
      const edge = operation.edge;
      const role = edge.props?.role ? ` (${edge.props.role})` : '';
      return { index, type: operation.type, summary: `Link ${nodeLabel(graph, edge.from)} → ${nodeLabel(graph, edge.to)} · ${edge.type}${role}`, entity: { id: edge.id, kind: 'edge', name: edge.id }, changes: [] };
    }
    case 'edge.remove': {
      const edge = graph.edges[operation.edgeId];
      return { index, type: operation.type, summary: edge ? `Unlink ${nodeLabel(graph, edge.from)} → ${nodeLabel(graph, edge.to)} · ${edge.type}` : `Remove edge ${operation.edgeId}`, entity: edge ? { id: edge.id, kind: 'edge', name: edge.id } : null, changes: [] };
    }
    default: return { index, type: String(operation.type), summary: `Unknown operation ${String(operation.type)}`, entity: null, changes: [] };
  }
}

export function createAgentPlanReview(graph, plan) {
  const clean = assertAgentPlanMatchesGraph(graph, plan);
  const operations = [];
  let cursor = graph;
  for (let index = 0; index < clean.operations.length; index += 1) {
    const operation = clean.operations[index];
    operations.push(reviewOperation(cursor, operation, index));
    cursor = applyOperation(cursor, operation);
  }
  const preview = previewAgentPlan(graph, clean);
  return {
    planId: clean.id,
    revision: clean.revision,
    intent: clean.intent,
    summary: clean.summary,
    provider: { ...clean.provider },
    baseFingerprint: clean.base.fingerprint,
    previewFingerprint: preview.fingerprint,
    impact: inspectAgentPlan(clean),
    operations,
  };
}
