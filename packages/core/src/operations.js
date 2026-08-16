import { addEdge, addNode, assertValidGraph, removeEdge, removeNode, updateNode } from "./graph.js";
import { createId } from "./id.js";
import { assertProjectInvariants } from "./invariants.js";
import { normalizeBoundedModelInput, normalizeBoundedModelJsonObject } from "./model-input.js";

export const OPERATION_TYPES = Object.freeze(["node.add", "node.update", "node.remove", "edge.add", "edge.remove"]);
const OPERATION_TYPE_SET = new Set(OPERATION_TYPES);
const MAX_TRANSACTION_LABEL_CHARS = 4096;

function isRecord(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function requireString(value, label) { if (typeof value !== "string" || !value.length) throw new Error(`${label} must be a non-empty string`); }
function ownDataField(value, key, label) {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error(`${label} ${key} must be an enumerable data property`);
  return descriptor.value;
}

export class OperationBatchError extends Error {
  constructor(message, { index = -1, operation = null, cause = null, phase = "apply" } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "OperationBatchError";
    this.index = index;
    this.operation = operation;
    this.phase = phase;
  }
}

function validateOperationData(operation) {
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
    case "node.remove": requireString(operation.nodeId, "node.remove nodeId"); break;
    case "edge.add":
      if (!isRecord(operation.edge)) throw new Error("edge.add requires an edge");
      requireString(operation.edge.id, "edge.add edge.id");
      requireString(operation.edge.from, "edge.add edge.from");
      requireString(operation.edge.to, "edge.add edge.to");
      break;
    case "edge.remove": requireString(operation.edgeId, "edge.remove edgeId"); break;
  }
  return operation;
}
function normalizeOperation(operation, label = "Operation") {
  return validateOperationData(normalizeBoundedModelInput(operation, label, { allowBinary: false }));
}
function normalizeOperationBatch(operations, label = "Operations") {
  if (!Array.isArray(operations)) throw new Error(`${label} must be an array`);
  const normalized = normalizeBoundedModelInput(operations, label, { allowBinary: false });
  normalized.forEach(validateOperationData);
  return normalized;
}
export function assertValidOperation(operation) {
  normalizeOperation(operation);
  return operation;
}

export function createTransaction(label, operations, metadata = {}) {
  const cleanLabel = label == null || label === "" ? "Edit" : label;
  requireString(cleanLabel, "Transaction label");
  if (cleanLabel.length > MAX_TRANSACTION_LABEL_CHARS) throw new Error(`Transaction label exceeds ${MAX_TRANSACTION_LABEL_CHARS} characters`);
  const cleanOperations = normalizeOperationBatch(operations, "Transaction operations");
  const cleanMetadata = normalizeBoundedModelJsonObject(metadata ?? {}, "Transaction metadata");
  return { id: createId("transaction"), label: cleanLabel, operations: cleanOperations, metadata: cleanMetadata };
}

function applyNormalizedOperation(graph, operation) {
  switch (operation.type) {
    case "node.add": return addNode(graph, operation.node);
    case "node.update": return updateNode(graph, operation.nodeId, operation.patch);
    case "node.remove": return removeNode(graph, operation.nodeId);
    case "edge.add": return addEdge(graph, operation.edge);
    case "edge.remove": return removeEdge(graph, operation.edgeId);
  }
}
export function applyOperation(graph, operation) {
  return applyNormalizedOperation(graph, normalizeOperation(operation));
}

function normalizePreflightOptions(options) {
  if (options == null) return { enforceInvariants: true };
  if (!isRecord(options)) throw new Error("Operation preflight options must be an object");
  const descriptors = Object.getOwnPropertyDescriptors(options);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (key !== "enforceInvariants") throw new Error(`Unsupported operation preflight option: ${String(key)}`);
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error("Operation preflight options must contain enumerable data properties only");
  }
  const enforceInvariants = descriptors.enforceInvariants?.value ?? true;
  if (typeof enforceInvariants !== "boolean") throw new Error("Operation preflight enforceInvariants must be a boolean");
  return { enforceInvariants };
}
export function preflightOperations(graph, operations, options = {}) {
  const { enforceInvariants } = normalizePreflightOptions(options);
  let normalized;
  try { normalized = normalizeOperationBatch(operations); }
  catch (error) { throw new OperationBatchError(error.message, { cause: error, phase: "schema" }); }
  let next = graph;
  for (let index = 0; index < normalized.length; index += 1) {
    try { next = applyNormalizedOperation(next, normalized[index]); }
    catch (error) {
      throw new OperationBatchError(`Operation batch failed at index ${index} (${normalized[index].type}): ${error.message}`, { index, operation: normalized[index], cause: error });
    }
  }
  try {
    assertValidGraph(next);
    if (enforceInvariants) assertProjectInvariants(next);
  } catch (error) {
    throw new OperationBatchError(`Operation batch produced an invalid project: ${error.message}`, { cause: error, phase: "invariants" });
  }
  return next;
}

export function applyOperations(graph, operations, options) { return preflightOperations(graph, operations, options); }

export function applyTransaction(graph, transaction, options) {
  if (!isRecord(transaction)) throw new Error("Transaction must be an object");
  const label = ownDataField(transaction, "label", "Transaction");
  const operations = ownDataField(transaction, "operations", "Transaction");
  requireString(label, "Transaction label");
  if (label.length > MAX_TRANSACTION_LABEL_CHARS) throw new Error(`Transaction label exceeds ${MAX_TRANSACTION_LABEL_CHARS} characters`);
  return applyOperations(graph, operations, options);
}
