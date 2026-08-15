import { assertValidGraph } from "./graph.js";
import { createId } from "./id.js";
import { canonicalOperationLogJson, operationLogChecksum } from "./operation-log.js";
import { applyOperations, assertValidOperation, createTransaction } from "./operations.js";

export const AGENT_PLAN_SCHEMA = "media.agent-plan.v1";

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}
function cloneJson(value, label) {
  try { return JSON.parse(canonicalOperationLogJson(value)); }
  catch (error) { throw new Error(`${label} must be JSON-safe: ${error.message}`, { cause: error }); }
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
  if (plan.schema !== AGENT_PLAN_SCHEMA) throw new Error(`Unsupported agent plan schema: ${plan.schema}`);
  requireString(plan.id, "Agent plan id");
  if (!Number.isSafeInteger(plan.revision) || plan.revision < 1) throw new Error("Agent plan revision must be a positive safe integer");
  requireString(plan.intent, "Agent plan intent");
  if (typeof plan.summary !== "string") throw new Error("Agent plan summary must be a string");
  requireString(plan.provider?.id, "Agent plan provider id");
  if (typeof plan.provider?.label !== "string") throw new Error("Agent plan provider label must be a string");
  requireString(plan.base?.projectId, "Agent plan base projectId");
  requireString(plan.base?.fingerprint, "Agent plan base fingerprint");
  requireString(plan.preview?.fingerprint, "Agent plan preview fingerprint");
  if (!Array.isArray(plan.operations)) throw new Error("Agent plan operations must be an array");
  plan.operations.forEach(assertValidOperation);
  canonicalOperationLogJson(plan);
  return plan;
}

export function inspectAgentPlan(plan) {
  assertAgentPlan(plan);
  const operationCounts = {};
  const nodeIds = new Set();
  const edgeIds = new Set();
  for (const operation of plan.operations) {
    operationCounts[operation.type] = (operationCounts[operation.type] ?? 0) + 1;
    if (operation.type === "node.add") nodeIds.add(operation.node.id);
    if (operation.type === "node.update" || operation.type === "node.remove") nodeIds.add(operation.nodeId);
    if (operation.type === "edge.add") edgeIds.add(operation.edge.id);
    if (operation.type === "edge.remove") edgeIds.add(operation.edgeId);
  }
  return {
    operationCount: plan.operations.length,
    operationCounts,
    nodeIds: [...nodeIds],
    edgeIds: [...edgeIds],
  };
}

export function assertAgentPlanMatchesGraph(graph, plan) {
  assertAgentPlan(plan);
  const actual = agentGraphFingerprint(graph);
  if (graph.projectId !== plan.base.projectId || actual !== plan.base.fingerprint) {
    throw new AgentPlanStaleError("Agent plan was created for a different project state", { expected: plan.base.fingerprint, actual });
  }
  return plan;
}

function finalizeAgentPlan(graph, {
  id = createId("agent-plan"),
  revision = 1,
  intent,
  summary = "",
  operations = [],
  providerId = "unknown",
  providerLabel = providerId,
  metadata = {},
  createdAt = new Date().toISOString(),
  updatedAt = createdAt,
} = {}) {
  const cleanIntent = requireString(intent, "Agent plan intent");
  const cleanProviderId = requireString(providerId, "Agent plan provider id");
  if (typeof summary !== "string") throw new Error("Agent plan summary must be a string");
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
    provider: { id: cleanProviderId, label: String(providerLabel ?? cleanProviderId) },
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
  assertAgentPlanMatchesGraph(graph, plan);
  const nextGraph = applyOperations(graph, plan.operations);
  const fingerprint = agentGraphFingerprint(nextGraph);
  if (fingerprint !== plan.preview.fingerprint) throw new Error("Agent plan preview fingerprint does not match its operations");
  return { graph: nextGraph, fingerprint, impact: inspectAgentPlan(plan) };
}

export function reviseAgentPlan(graph, plan, operations, { summary = plan?.summary, metadata = plan?.metadata } = {}) {
  assertAgentPlanMatchesGraph(graph, plan);
  return finalizeAgentPlan(graph, {
    id: plan.id,
    revision: plan.revision + 1,
    createdAt: plan.createdAt,
    updatedAt: new Date().toISOString(),
    intent: plan.intent,
    summary,
    operations,
    providerId: plan.provider.id,
    providerLabel: plan.provider.label,
    metadata,
  });
}

export function createAgentPlanTransaction(graph, plan, { label = plan?.summary || "Agent edit", metadata = {} } = {}) {
  previewAgentPlan(graph, plan);
  const cleanMetadata = cloneJson(metadata, "Agent transaction metadata");
  return createTransaction(label || "Agent edit", cloneJson(plan.operations, "Agent plan operations"), {
    ...cleanMetadata,
    source: "agent",
    agentPlan: {
      schema: plan.schema,
      id: plan.id,
      revision: plan.revision,
      providerId: plan.provider.id,
      intent: plan.intent,
      baseFingerprint: plan.base.fingerprint,
      previewFingerprint: plan.preview.fingerprint,
    },
  });
}

export function applyAgentPlan(graph, plan) {
  return previewAgentPlan(graph, plan).graph;
}
