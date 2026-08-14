import { addEdge, addNode, assertValidGraph, removeEdge, removeNode, updateNode } from "./graph.js";
import { createId } from "./id.js";

export const OPERATION_TYPES = Object.freeze(["node.add", "node.update", "node.remove", "edge.add", "edge.remove"]);
const OPERATION_TYPE_SET = new Set(OPERATION_TYPES);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.length) throw new Error(`${label} must be a non-empty string`);
}

export function assertValidOperation(operation) {
  if (!isRecord(operation)) throw new Error("Operation must be an object");
  if (!OPERATION_TYPE_SET.has(operation.type)) throw new Error(`Unsupported operation: ${operation.type}`);
  switch (operation.type) {
    case "node.add":
      if (!isRecord(operation.node)) throw new Error("node.add requires a node");
      requireString(operation.node.id, "node.add node.id");
      requireString(operation.node.kind, "node.add node.kind");
      break;
    case "node.update":
      requireString(operation.nodeId, "node.update nodeId");
      if (!isRecord(operation.patch)) throw new Error("node.update requires an object patch");
      break;
    case "node.remove":
      requireString(operation.nodeId, "node.remove nodeId");
      break;
    case "edge.add":
      if (!isRecord(operation.edge)) throw new Error("edge.add requires an edge");
      requireString(operation.edge.id, "edge.add edge.id");
      requireString(operation.edge.from, "edge.add edge.from");
      requireString(operation.edge.to, "edge.add edge.to");
      break;
    case "edge.remove":
      requireString(operation.edgeId, "edge.remove edgeId");
      break;
  }
  return operation;
}

export function createTransaction(label, operations, metadata = {}) {
  if (!Array.isArray(operations)) throw new Error("Transaction operations must be an array");
  operations.forEach(assertValidOperation);
  return {
    id: createId("transaction"),
    label: String(label || "Edit"),
    operations: [...operations],
    metadata: { ...metadata },
  };
}

export function applyOperation(graph, operation) {
  assertValidOperation(operation);
  switch (operation.type) {
    case "node.add": return addNode(graph, operation.node);
    case "node.update": return updateNode(graph, operation.nodeId, operation.patch);
    case "node.remove": return removeNode(graph, operation.nodeId);
    case "edge.add": return addEdge(graph, operation.edge);
    case "edge.remove": return removeEdge(graph, operation.edgeId);
  }
}

export function applyOperations(graph, operations) {
  if (!Array.isArray(operations)) throw new Error("Operations must be an array");
  operations.forEach(assertValidOperation);
  let next = graph;
  for (let index = 0; index < operations.length; index += 1) {
    try {
      next = applyOperation(next, operations[index]);
    } catch (error) {
      throw new Error(`Operation batch failed at index ${index} (${operations[index].type}): ${error.message}`, { cause: error });
    }
  }
  return assertValidGraph(next);
}

export function applyTransaction(graph, transaction) {
  if (!isRecord(transaction)) throw new Error("Transaction must be an object");
  requireString(transaction.label, "Transaction label");
  return applyOperations(graph, transaction.operations);
}
