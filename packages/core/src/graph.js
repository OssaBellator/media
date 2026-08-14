import { createId } from "./id.js";

export const GRAPH_VERSION = 1;
export const NODE_KINDS = Object.freeze(["project", "asset", "composition", "track", "clip", "layer", "effect", "output"]);
export const EDGE_TYPES = Object.freeze(["contains", "references", "derives-from", "synchronizes", "targets"]);
const NODE_KIND_SET = new Set(NODE_KINDS);
const EDGE_TYPE_SET = new Set(EDGE_TYPES);

export function createNode({ id = createId("node"), kind, name, props = {}, now = new Date().toISOString() }) {
  if (!NODE_KIND_SET.has(kind)) throw new Error(`Unsupported node kind: ${kind}`);
  return { id, kind, name: name || kind, createdAt: now, updatedAt: now, props: { ...props } };
}

export function createEdge({ id = createId("edge"), from, to, type = "contains", props = {} }) {
  if (!EDGE_TYPE_SET.has(type)) throw new Error(`Unsupported edge type: ${type}`);
  return { id, from, to, type, props: { ...props } };
}

export function createGraph(projectName = "Untitled project") {
  const project = createNode({ id: createId("project"), kind: "project", name: projectName });
  return { version: GRAPH_VERSION, projectId: project.id, nodes: { [project.id]: project }, edges: {} };
}

export function addNode(graph, node) {
  if (graph.nodes[node.id]) throw new Error(`Node already exists: ${node.id}`);
  return { ...graph, nodes: { ...graph.nodes, [node.id]: node } };
}

export function updateNode(graph, nodeId, patch) {
  const current = graph.nodes[nodeId];
  if (!current) throw new Error(`Unknown node: ${nodeId}`);
  const next = {
    ...current,
    ...patch,
    id: current.id,
    kind: current.kind,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
    props: patch.props ? { ...current.props, ...patch.props } : current.props,
  };
  return { ...graph, nodes: { ...graph.nodes, [nodeId]: next } };
}

export function removeNode(graph, nodeId) {
  if (nodeId === graph.projectId) throw new Error("The project root cannot be removed");
  if (!graph.nodes[nodeId]) return graph;
  const nodes = { ...graph.nodes };
  delete nodes[nodeId];
  const edges = Object.fromEntries(Object.entries(graph.edges).filter(([, edge]) => edge.from !== nodeId && edge.to !== nodeId));
  return { ...graph, nodes, edges };
}

export function addEdge(graph, edge) {
  if (graph.edges[edge.id]) throw new Error(`Edge already exists: ${edge.id}`);
  if (!graph.nodes[edge.from] || !graph.nodes[edge.to]) throw new Error(`Edge ${edge.id} references an unknown node`);
  return { ...graph, edges: { ...graph.edges, [edge.id]: edge } };
}

export function removeEdge(graph, edgeId) {
  if (!graph.edges[edgeId]) return graph;
  const edges = { ...graph.edges };
  delete edges[edgeId];
  return { ...graph, edges };
}

export function edgesFrom(graph, nodeId, type) {
  return Object.values(graph.edges).filter((edge) => edge.from === nodeId && (!type || edge.type === type));
}

export function edgesTo(graph, nodeId, type) {
  return Object.values(graph.edges).filter((edge) => edge.to === nodeId && (!type || edge.type === type));
}

export function childrenOf(graph, nodeId, kind) {
  return edgesFrom(graph, nodeId, "contains")
    .map((edge) => graph.nodes[edge.to])
    .filter(Boolean)
    .filter((node) => !kind || node.kind === kind);
}

export function referencesFrom(graph, nodeId) {
  return edgesFrom(graph, nodeId, "references").map((edge) => graph.nodes[edge.to]).filter(Boolean);
}

export function nodesByKind(graph, kind) {
  return Object.values(graph.nodes).filter((node) => node.kind === kind);
}

export function assertValidGraph(graph) {
  if (!graph || typeof graph !== "object") throw new Error("Graph must be an object");
  if (graph.version !== GRAPH_VERSION) throw new Error(`Unsupported graph version: ${graph.version}`);
  if (!graph.nodes || typeof graph.nodes !== "object" || !graph.edges || typeof graph.edges !== "object") throw new Error("Graph must contain node and edge maps");
  const project = graph.nodes[graph.projectId];
  if (!project || project.kind !== "project") throw new Error("Graph must contain a valid project root");
  for (const [key, node] of Object.entries(graph.nodes)) {
    if (key !== node.id) throw new Error(`Node key does not match node id: ${key}`);
    if (!NODE_KIND_SET.has(node.kind)) throw new Error(`Unsupported node kind in graph: ${node.kind}`);
    if (!node.props || typeof node.props !== "object" || Array.isArray(node.props)) throw new Error(`Node props must be an object: ${node.id}`);
  }
  for (const [key, edge] of Object.entries(graph.edges)) {
    if (key !== edge.id) throw new Error(`Edge key does not match edge id: ${key}`);
    if (!EDGE_TYPE_SET.has(edge.type)) throw new Error(`Unsupported edge type in graph: ${edge.type}`);
    if (!graph.nodes[edge.from] || !graph.nodes[edge.to]) throw new Error(`Dangling edge: ${edge.id}`);
  }
  return graph;
}
