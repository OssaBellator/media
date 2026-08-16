import { assertValidGraph } from "./graph.js";
import { createId } from "./id.js";
import { canonicalOperationLogJson, operationLogChecksum } from "./operation-log.js";
import { applyOperations, assertValidOperation, createTransaction } from "./operations.js";

export const AGENT_PLAN_SCHEMA = "media.agent-plan.v1";

const AGENT_PLAN_OPTION_KEYS = new Set(["id", "revision", "intent", "summary", "operations", "providerId", "providerLabel", "metadata", "createdAt", "updatedAt"]);
const AGENT_PLAN_REVISION_OPTION_KEYS = new Set(["summary", "metadata"]);
const AGENT_PLAN_TRANSACTION_OPTION_KEYS = new Set(["label", "metadata"]);

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}
function cloneJson(value, label) {
  try { return JSON.parse(canonicalOperationLogJson(value)); }
  catch (error) { throw new Error(`${label} must be JSON-safe: ${error.message}`, { cause: error }); }
}
function dataOptions(value, label, allowedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a plain data object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} must be a plain data object`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const clean = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !allowedKeys.has(key)) throw new Error(`Unsupported ${label} field: ${String(key)}`);
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error(`${label} must contain enumerable data fields only`);
    clean[key] = descriptor.value;
  }
  return clean;
}
function operationSelectionIndexes(operationIndexes, operationCount) {
  if (!Array.isArray(operationIndexes)) throw new Error("Agent plan operation selection must be an array");
  const seen = new Set(), indexes = [];
  for (let position = 0; position < operationIndexes.length; position += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(operationIndexes, String(position));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error("Agent plan operation selection must contain dense enumerable data indexes only");
    const index = descriptor.value;
    if (!Number.isSafeInteger(index) || index < 0 || index >= operationCount) throw new Error("Agent plan operation index is out of range");
    if (seen.has(index)) throw new Error(`Agent plan operation index is duplicated: ${index}`);
    seen.add(index);indexes.push(index);
  }
  return indexes.sort((a, b) => a - b);
}
function graphFingerprintPayload(graph) {
  assertValidGraph(graph);
  const nodes = Object.fromEntries(Object.entries(graph.nodes).map(([id, node]) => [id, {
    id: node.id,
    kind: node.kind,
    name: node.name,
    props: node.props,
  }]));
  const edges = Object.fromEntries(Object.entries(graph.edges).map(([id, edge]) => [id, {
    id: edge.id,
    from: edge.from,
    to: edge.to,
    type: edge.type,
    props: edge.props,
  }]));
  return { version: graph.version, projectId: graph.projectId, nodes, edges };
}

export function agentGraphFingerprint(graph) {
  return operationLogChecksum(graphFingerprintPayload(graph));
}

export class AgentPlanStaleError extends Error {
  constructor(message, { expected = null, actual = null } = {}) {
    super(message);
    this.name = "AgentPlanStaleError";
    this.code = "AGENT_PLAN_STALE";
    this.expected = expected;
    this.actual = actual;
  }
}

export function assertAgentPlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) throw new Error("Agent plan must be an object");
  const clean = cloneJson(plan, "Agent plan");
  if (clean.schema !== AGENT_PLAN_SCHEMA) throw new Error(`Unsupported agent plan schema: ${clean.schema}`);
  requireString(clean.id, "Agent plan id");
  if (!Number.isSafeInteger(clean.revision) || clean.revision < 1) throw new Error("Agent plan revision must be a positive safe integer");
  requireString(clean.intent, "Agent plan intent");
  if (typeof clean.summary !== "string") throw new Error("Agent plan summary must be a string");
  requireString(clean.provider?.id, "Agent plan provider id");
  if (typeof clean.provider?.label !== "string") throw new Error("Agent plan provider label must be a string");
  requireString(clean.base?.projectId, "Agent plan base projectId");
  requireString(clean.base?.fingerprint, "Agent plan base fingerprint");
  requireString(clean.preview?.fingerprint, "Agent plan preview fingerprint");
  if (!Array.isArray(clean.operations)) throw new Error("Agent plan operations must be an array");
  clean.operations.forEach(assertValidOperation);
  return clean;
}

export function inspectAgentPlan(plan) {
  const clean = assertAgentPlan(plan);
  const operationCounts = {};
  const nodeIds = new Set();
  const edgeIds = new Set();
  for (const operation of clean.operations) {
    operationCounts[operation.type] = (operationCounts[operation.type] ?? 0) + 1;
    if (operation.type === "node.add") nodeIds.add(operation.node.id);
    if (operation.type === "node.update" || operation.type === "node.remove") nodeIds.add(operation.nodeId);
    if (operation.type === "edge.add") edgeIds.add(operation.edge.id);
    if (operation.type === "edge.remove") edgeIds.add(operation.edgeId);
  }
  return {
    operationCount: clean.operations.length,
    operationCounts,
    nodeIds: [...nodeIds],
    edgeIds: [...edgeIds],
  };
}

export function assertAgentPlanMatchesGraph(graph, plan) {
  const clean = assertAgentPlan(plan);
  const actual = agentGraphFingerprint(graph);
  if (graph.projectId !== clean.base.projectId || actual !== clean.base.fingerprint) {
    throw new AgentPlanStaleError("Agent plan was created for a different project state", { expected: clean.base.fingerprint, actual });
  }
  return clean;
}

function finalizeAgentPlan(graph, options = {}) {
  const config = dataOptions(options, "Agent plan options", AGENT_PLAN_OPTION_KEYS);
  const id = config.id === undefined ? createId("agent-plan") : config.id;
  const revision = config.revision === undefined ? 1 : config.revision;
  const intent = config.intent;
  const summary = config.summary === undefined ? "" : config.summary;
  const operations = config.operations === undefined ? [] : config.operations;
  const providerId = config.providerId === undefined ? "unknown" : config.providerId;
  const metadata = config.metadata === undefined ? {} : config.metadata;
  const createdAt = config.createdAt === undefined ? new Date().toISOString() : config.createdAt;
  const updatedAt = config.updatedAt === undefined ? createdAt : config.updatedAt;
  const cleanIntent = requireString(intent, "Agent plan intent");
  const cleanProviderId = requireString(providerId, "Agent plan provider id");
  const providerLabel = config.providerLabel == null ? cleanProviderId : config.providerLabel;
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("Agent plan revision must be a positive safe integer");
  if (typeof summary !== "string") throw new Error("Agent plan summary must be a string");
  if (typeof providerLabel !== "string") throw new Error("Agent plan provider label must be a string");
  if (!Array.isArray(operations)) throw new Error("Agent plan operations must be an array");
  const cleanOperations = cloneJson(operations, "Agent plan operations");
  const previewGraph = applyOperations(graph, cleanOperations);
  const plan = {
    schema: AGENT_PLAN_SCHEMA,
    id: requireString(id, "Agent plan id"),
    revision,
    createdAt: requireString(createdAt, "Agent plan createdAt"),
    updatedAt: requireString(updatedAt, "Agent plan updatedAt"),
    intent: cleanIntent,
    summary,
    provider: { id: cleanProviderId, label: providerLabel },
    base: { projectId: graph.projectId, fingerprint: agentGraphFingerprint(graph) },
    preview: { fingerprint: agentGraphFingerprint(previewGraph) },
    operations: cleanOperations,
    metadata: cloneJson(metadata, "Agent plan metadata"),
  };
  return assertAgentPlan(plan);
}

export function createAgentPlan(graph, options = {}) {
  return finalizeAgentPlan(graph, options);
}

export function previewAgentPlan(graph, plan) {
  const clean = assertAgentPlanMatchesGraph(graph, plan);
  const nextGraph = applyOperations(graph, clean.operations);
  const fingerprint = agentGraphFingerprint(nextGraph);
  if (fingerprint !== clean.preview.fingerprint) throw new Error("Agent plan preview fingerprint does not match its operations");
  return { graph: nextGraph, fingerprint, impact: inspectAgentPlan(clean) };
}

export function reviseAgentPlan(graph, plan, operations, options = {}) {
  const clean = assertAgentPlanMatchesGraph(graph, plan);
  const config = dataOptions(options, "Agent plan revision options", AGENT_PLAN_REVISION_OPTION_KEYS);
  const summary = config.summary === undefined ? clean.summary : config.summary;
  const metadata = config.metadata === undefined ? clean.metadata : config.metadata;
  return finalizeAgentPlan(graph, {
    id: clean.id,
    revision: clean.revision + 1,
    createdAt: clean.createdAt,
    updatedAt: new Date().toISOString(),
    intent: clean.intent,
    summary,
    operations,
    providerId: clean.provider.id,
    providerLabel: clean.provider.label,
    metadata,
  });
}

export function selectAgentPlanOperations(graph, plan, operationIndexes, options = {}) {
  const clean = assertAgentPlanMatchesGraph(graph, plan);
  const indexes = operationSelectionIndexes(operationIndexes, clean.operations.length);
  const config = dataOptions(options, "Agent plan selection options", AGENT_PLAN_REVISION_OPTION_KEYS);
  return reviseAgentPlan(graph, clean, indexes.map((index) => clean.operations[index]), config);
}

export function createAgentPlanTransaction(graph, plan, options = {}) {
  const config = dataOptions(options, "Agent transaction options", AGENT_PLAN_TRANSACTION_OPTION_KEYS);
  const clean = assertAgentPlanMatchesGraph(graph, plan);
  previewAgentPlan(graph, clean);
  const label = config.label ?? (clean.summary || "Agent edit");
  const cleanMetadata = cloneJson(config.metadata ?? {}, "Agent transaction metadata");
  return createTransaction(label || "Agent edit", clean.operations, {
    ...cleanMetadata,
    source: "agent",
    agentPlan: {
      schema: clean.schema,
      id: clean.id,
      revision: clean.revision,
      providerId: clean.provider.id,
      intent: clean.intent,
      baseFingerprint: clean.base.fingerprint,
      previewFingerprint: clean.preview.fingerprint,
    },
  });
}

export function applyAgentPlan(graph, plan) {
  return previewAgentPlan(graph, plan).graph;
}
