import { addEdge, addNode, assertValidGraph, removeEdge, removeNode, updateNode } from "./graph.js";

export function applyOperation(graph, operation) {
  switch (operation.type) {
    case "node.add":
      return addNode(graph, operation.node);
    case "node.update":
      return updateNode(graph, operation.nodeId, operation.patch);
    case "node.remove":
      return removeNode(graph, operation.nodeId);
    case "edge.add":
      return addEdge(graph, operation.edge);
    case "edge.remove":
      return removeEdge(graph, operation.edgeId);
    default:
      throw new Error(`Unsupported operation: ${operation.type}`);
  }
}

export function applyOperations(graph, operations) {
  const next = operations.reduce((current, operation) => applyOperation(current, operation), graph);
  return assertValidGraph(next);
}
