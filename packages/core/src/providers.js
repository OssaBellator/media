import { createAgentPlan } from "./agent-plan.js";
import { createAgentWorkflow, MAX_AGENT_WORKFLOW_BYTES, MAX_AGENT_WORKFLOW_TASKS } from "./agent-workflow.js";
import { normalizeBoundedModelInput, normalizeBoundedModelJsonObject } from "./model-input.js";
import { canonicalOperationLogJson } from "./operation-log.js";
import { assertValidOperation } from "./operations.js";
import { planIntent } from "./planner.js";
import { searchSemanticGraph } from "./semantic-search.js";

export const MAX_PLANNER_OPERATIONS = 2048;
export const MAX_PLANNER_SUMMARY_CHARS = 4096;
export const MAX_PLANNER_INTENT_CHARS = 16_384;
export const DEFAULT_PLANNER_RESULT_BYTES = 2 * 1024 * 1024;
export const DEFAULT_PLANNER_REQUEST_BYTES = 4 * 1024 * 1024;
export const DEFAULT_PLANNER_CONTEXT_BYTES = 64 * 1024;
export const MAX_PLANNER_CONTEXT_BYTES = 1024 * 1024;
export const MAX_PLANNER_RESULT_BYTES = 8 * 1024 * 1024;
export const MAX_PLANNER_PROVIDER_ID_CHARS = 160;
export const MAX_PLANNER_PROVIDER_LABEL_CHARS = 256;
export const MAX_PLANNER_PROVIDER_CAPABILITIES = 32;
export const MAX_PLANNER_PROVIDER_CAPABILITY_CHARS = 64;
export const MAX_PLANNER_PROVIDERS = 256;
export const MAX_HTTP_PLANNER_REQUEST_BYTES = 16 * 1024 * 1024;
export const MAX_HTTP_PLANNER_RESPONSE_BYTES = 8 * 1024 * 1024;
export const MAX_HTTP_PLANNER_HEADERS_BYTES = 16 * 1024;
export const MAX_HTTP_PLANNER_TIMEOUT_MS = 10 * 60 * 1000;
const PLANNER_FACTORY_JSON_BYTES = 64 * 1024;
const PLANNER_PROVIDER_KEYS = new Set(["id", "label", "capabilities", "plan"]);
const WORKFLOW_PROVIDER_KEYS = new Set(["id", "label", "capabilities", "proposeWorkflow"]);
const MODEL_PLANNER_FACTORY_KEYS = new Set(["router", "id", "label", "policy", "contextMode", "semanticContextOptions"]);
const HTTP_PLANNER_FACTORY_KEYS = new Set(["id", "label", "endpoint", "headers", "timeoutMs", "maxResponseBytes", "maxRequestBytes", "fetchImpl"]);
const SEMANTIC_CONTEXT_OPTION_KEYS = new Set(["limit", "neighborDepth", "maxNodes", "kinds"]);
const PLANNER_SNAPSHOT_OPTION_KEYS = new Set(["focusNodeIds", "neighborDepth", "maxNodes"]);
const PLANNER_RESULT_OPTION_KEYS = new Set(["maxResultBytes"]);
const PLANNER_INVOCATION_OPTION_KEYS = new Set(["maxContextBytes", "maxResultBytes"]);
const WORKFLOW_INVOCATION_OPTION_KEYS = new Set(["signal", "maxContextBytes", "maxResultBytes"]);
export const MAX_PLANNER_FOCUS_NODE_IDS = 4096;
export const MAX_PLANNER_FOCUS_NODE_ID_CHARS = 512;

function utf8Bytes(text) { return new TextEncoder().encode(text).byteLength; }
export function normalizePlannerIntent(intent, label = "Planner intent") {
  if (typeof intent !== "string" || !intent.trim()) throw new Error(`${label} must be non-empty`);
  const clean = intent.trim();
  if (clean.length > MAX_PLANNER_INTENT_CHARS) throw new Error(`${label} exceeds ${MAX_PLANNER_INTENT_CHARS} characters`);
  return clean;
}
export function normalizePlannerContext(context = {}, maxContextBytes = DEFAULT_PLANNER_CONTEXT_BYTES) {
  return normalizeBoundedModelJsonObject(context, "Planner context", { maxBytes: maxContextBytes });
}
function normalizePlannerResultOptions(options = {}, { workflow = false } = {}) {
  const clean = normalizeFactoryDescriptor(options, workflow ? "Workflow result" : "Planner result", PLANNER_RESULT_OPTION_KEYS);
  const ceiling = workflow ? MAX_AGENT_WORKFLOW_BYTES : MAX_PLANNER_RESULT_BYTES;
  const fallback = workflow ? MAX_AGENT_WORKFLOW_BYTES : DEFAULT_PLANNER_RESULT_BYTES;
  return Object.freeze({ maxResultBytes: strictFactoryNumber(clean.maxResultBytes, `${workflow ? "Workflow" : "Planner"} result maxResultBytes`, { fallback, min: 256, max: ceiling }) });
}
function normalizePlannerInvocationOptions(options = {}, { workflow = false } = {}) {
  const clean = normalizeFactoryDescriptor(options, workflow ? "Workflow planner invocation" : "Planner invocation", workflow ? WORKFLOW_INVOCATION_OPTION_KEYS : PLANNER_INVOCATION_OPTION_KEYS);
  const maxContextBytes = strictFactoryNumber(clean.maxContextBytes, `${workflow ? "Workflow planner" : "Planner"} maxContextBytes`, { fallback: DEFAULT_PLANNER_CONTEXT_BYTES, min: 256, max: MAX_PLANNER_CONTEXT_BYTES });
  const result = normalizePlannerResultOptions(clean.maxResultBytes === undefined ? {} : { maxResultBytes: clean.maxResultBytes }, { workflow });
  return Object.freeze({ ...(workflow ? { signal: clean.signal } : {}), maxContextBytes, maxResultBytes: result.maxResultBytes });
}
function boundedProviderString(value, label, maxChars) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  const clean = value.trim();
  if (clean.length > maxChars) throw new Error(`${label} exceeds ${maxChars} characters`);
  return clean;
}
function normalizeProviderCapabilities(value, fallback, label) {
  const clean = normalizeBoundedModelInput(value ?? fallback, `${label} capabilities`, { maxBytes: 4096, maxDepth: 2, maxEntries: MAX_PLANNER_PROVIDER_CAPABILITIES, allowBinary: false });
  if (!Array.isArray(clean)) throw new Error(`${label} capabilities must be an array`);
  return [...new Set(clean.map((capability) => boundedProviderString(capability, `${label} capability`, MAX_PLANNER_PROVIDER_CAPABILITY_CHARS)))];
}
function normalizeProviderDescriptor(provider, { workflow = false } = {}) {
  const label = workflow ? "Workflow provider" : "Planner provider";
  if (!provider || typeof provider !== "object" || Array.isArray(provider)) throw new Error(`${label} must be an object`);
  const prototype = Object.getPrototypeOf(provider);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} must be a plain data object`);
  const keys = workflow ? WORKFLOW_PROVIDER_KEYS : PLANNER_PROVIDER_KEYS;
  const descriptors = Object.getOwnPropertyDescriptors(provider);
  const clean = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !keys.has(key)) throw new Error(`Unsupported ${label.toLowerCase()} field: ${String(key)}`);
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !("value" in descriptor)) throw new Error(`${label} must contain enumerable data fields only`);
    clean[key] = descriptor.value;
  }
  const id = boundedProviderString(clean.id, `${label} id`, MAX_PLANNER_PROVIDER_ID_CHARS);
  const providerLabel = clean.label === undefined ? id : boundedProviderString(clean.label, `${label} label`, MAX_PLANNER_PROVIDER_LABEL_CHARS);
  const capabilities = Object.freeze(normalizeProviderCapabilities(clean.capabilities, [workflow ? "workflow" : "plan"], label));
  const method = workflow ? clean.proposeWorkflow : clean.plan;
  if (typeof method !== "function") throw new Error(`${label} ${id} requires a ${workflow ? "proposeWorkflow" : "plan"} function`);
  return Object.freeze({ id, label: providerLabel, capabilities, [workflow ? "proposeWorkflow" : "plan"]: method });
}
function normalizeFactoryDescriptor(config, label, allowedKeys) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error(`${label} config must be an object`);
  const prototype = Object.getPrototypeOf(config);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} config must be a plain data object`);
  const descriptors = Object.getOwnPropertyDescriptors(config);
  const clean = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !allowedKeys.has(key)) throw new Error(`Unsupported ${label.toLowerCase()} config field: ${String(key)}`);
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !("value" in descriptor)) throw new Error(`${label} config must contain enumerable data fields only`);
    clean[key] = descriptor.value;
  }
  return clean;
}
function strictFactoryNumber(value, label, { fallback, min, max, integer = true }) {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < min || value > max) throw new Error(`${label} must be ${integer ? "an integer" : "a number"} from ${min} to ${max}`);
  return value;
}
function normalizeSemanticContextOptions(value = {}) {
  const clean = normalizeBoundedModelJsonObject(value, "Semantic planner context options", { maxBytes: PLANNER_FACTORY_JSON_BYTES });
  for (const key of Object.keys(clean)) if (!SEMANTIC_CONTEXT_OPTION_KEYS.has(key)) throw new Error(`Unsupported semantic planner context option: ${key}`);
  const normalized = {};
  if (clean.limit !== undefined) normalized.limit = strictFactoryNumber(clean.limit, "Semantic planner limit", { fallback: 12, min: 1, max: 200 });
  if (clean.neighborDepth !== undefined) normalized.neighborDepth = strictFactoryNumber(clean.neighborDepth, "Semantic planner neighborDepth", { fallback: 1, min: 0, max: 4 });
  if (clean.maxNodes !== undefined) normalized.maxNodes = strictFactoryNumber(clean.maxNodes, "Semantic planner maxNodes", { fallback: 256, min: 1, max: 4096 });
  if (clean.kinds !== undefined) {
    if (!Array.isArray(clean.kinds) || clean.kinds.length > 32 || clean.kinds.some((kind) => typeof kind !== "string" || !kind.trim() || kind.length > 64)) throw new Error("Semantic planner kinds must contain at most 32 bounded strings");
    normalized.kinds = [...new Set(clean.kinds.map((kind) => kind.trim()))];
  }
  return Object.freeze(normalized);
}
function normalizePlannerSnapshotOptions(value = {}) {
  const clean = normalizeFactoryDescriptor(value, "Planner snapshot", PLANNER_SNAPSHOT_OPTION_KEYS);
  const focusNodeIds = clean.focusNodeIds == null ? null : normalizeBoundedModelInput(clean.focusNodeIds, "Planner focus node ids", { maxBytes: 2 * 1024 * 1024, maxDepth: 2, maxEntries: MAX_PLANNER_FOCUS_NODE_IDS, allowBinary: false });
  if (focusNodeIds !== null && (!Array.isArray(focusNodeIds) || focusNodeIds.some((id) => typeof id !== "string" || !id.trim() || id.length > MAX_PLANNER_FOCUS_NODE_ID_CHARS))) throw new Error("Planner focus node ids must be bounded strings");
  return Object.freeze({
    focusNodeIds: focusNodeIds === null ? null : Object.freeze([...new Set(focusNodeIds.map((id) => id.trim()))]),
    neighborDepth: strictFactoryNumber(clean.neighborDepth, "Planner snapshot neighborDepth", { fallback: 0, min: 0, max: 4 }),
    maxNodes: strictFactoryNumber(clean.maxNodes, "Planner snapshot maxNodes", { fallback: 256, min: 1, max: 4096 }),
  });
}
function normalizeHttpPlannerHeaders(value = {}) {
  const clean = normalizeBoundedModelJsonObject(value, "HTTP planner headers", { maxBytes: MAX_HTTP_PLANNER_HEADERS_BYTES });
  const headers = {};
  for (const [key, item] of Object.entries(clean)) {
    if (!key.trim() || key.length > 256 || typeof item !== "string" || item.length > 4096) throw new Error("HTTP planner headers must be bounded string pairs");
    headers[key] = item;
  }
  return Object.freeze(headers);
}
function requireProvider(provider) { return normalizeProviderDescriptor(provider); }
function requireWorkflowProvider(provider) { return normalizeProviderDescriptor(provider, { workflow: true }); }

export function assertPlannerResult(result, options = {}) {
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Planner result must be an object");
  const { maxResultBytes: byteLimit } = normalizePlannerResultOptions(options);
  const clean = normalizeBoundedModelJsonObject(result, "Planner result", { maxBytes: byteLimit });
  if (typeof clean.summary !== "string") throw new Error("Planner result requires a summary");
  if (clean.summary.length > MAX_PLANNER_SUMMARY_CHARS) throw new Error(`Planner result summary exceeds ${MAX_PLANNER_SUMMARY_CHARS} characters`);
  if (!Array.isArray(clean.operations)) throw new Error("Planner result requires an operations array");
  if (clean.operations.length > MAX_PLANNER_OPERATIONS) throw new Error(`Planner result exceeds ${MAX_PLANNER_OPERATIONS} operations`);
  clean.operations.forEach(assertValidOperation);
  const normalized = { summary: clean.summary, operations: clean.operations };
  if (clean.metadata !== undefined) {
    if (!clean.metadata || typeof clean.metadata !== "object" || Array.isArray(clean.metadata)) throw new Error("Planner result metadata must be an object");
    normalized.metadata = clean.metadata;
  }
  const canonical = canonicalOperationLogJson(normalized);
  if (utf8Bytes(canonical) > byteLimit) throw new Error(`Planner result exceeds ${byteLimit} bytes`);
  return JSON.parse(canonical);
}

export function createPlannerProvider(config = {}) {
  return requireProvider(config);
}

export function assertWorkflowPlannerResult(result, options = {}) {
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Workflow planner result must be an object");
  const { maxResultBytes: byteLimit } = normalizePlannerResultOptions(options, { workflow: true });
  const clean = normalizeBoundedModelJsonObject(result, "Workflow planner result", { maxBytes: byteLimit });
  const planner = assertPlannerResult({ summary: clean.summary, operations: clean.operations, ...(clean.metadata !== undefined ? { metadata: clean.metadata } : {}) }, { maxResultBytes: byteLimit });
  if (!Array.isArray(clean.tasks)) throw new Error("Workflow planner result requires a tasks array");
  if (clean.tasks.length > MAX_AGENT_WORKFLOW_TASKS) throw new Error(`Workflow planner result exceeds ${MAX_AGENT_WORKFLOW_TASKS} tasks`);
  const normalized = { ...planner, tasks: clean.tasks };
  const canonical = canonicalOperationLogJson(normalized);
  if (utf8Bytes(canonical) > byteLimit) throw new Error(`Workflow planner result exceeds ${byteLimit} bytes`);
  return JSON.parse(canonical);
}

export function createWorkflowPlannerProvider(config = {}) {
  return requireWorkflowProvider(config);
}

export async function proposeAgentWorkflowWithProvider(provider, graph, intent, context = {}, options = {}) {
  const valid = requireWorkflowProvider(provider);
  const cleanIntent = normalizePlannerIntent(intent, "Workflow planner intent");
  const invocation = normalizePlannerInvocationOptions(options, { workflow: true });
  const cleanContext = normalizePlannerContext(context, invocation.maxContextBytes);
  const result = assertWorkflowPlannerResult(await valid.proposeWorkflow({ graph, intent: cleanIntent, context: cleanContext, signal: invocation.signal }), { maxResultBytes: invocation.maxResultBytes });
  const plan = createAgentPlan(graph, {
    intent: cleanIntent,
    summary: result.summary,
    operations: result.operations,
    providerId: valid.id,
    providerLabel: valid.label ?? valid.id,
    metadata: {
      providerCapabilities: [...(valid.capabilities ?? [])],
      ...(result.metadata ? { workflowPlanner: result.metadata } : {}),
    },
  });
  return createAgentWorkflow(plan, result.tasks);
}

export function createLocalPlannerProvider() {
  return createPlannerProvider({ id: "local", label: "Local deterministic planner", capabilities: ["plan", "offline"], plan: async ({ graph, intent }) => planIntent(graph, intent) });
}

export async function planWithProvider(provider, graph, intent, context = {}, options = {}) {
  const valid = requireProvider(provider);
  const cleanIntent = normalizePlannerIntent(intent);
  const invocation = normalizePlannerInvocationOptions(options);
  const cleanContext = normalizePlannerContext(context, invocation.maxContextBytes);
  const result = await valid.plan({ graph, intent: cleanIntent, context: cleanContext });
  return assertPlannerResult(result, { maxResultBytes: invocation.maxResultBytes });
}

export async function proposeWithProvider(provider, graph, intent, context = {}, options = {}) {
  const valid = requireProvider(provider);
  const cleanIntent = normalizePlannerIntent(intent);
  const result = await planWithProvider(valid, graph, cleanIntent, context, options);
  return createAgentPlan(graph, {
    intent: cleanIntent,
    summary: result.summary,
    operations: result.operations,
    providerId: valid.id,
    providerLabel: valid.label ?? valid.id,
    metadata: { providerCapabilities: [...(valid.capabilities ?? [])], ...(result.metadata ? { planner: result.metadata } : {}) },
  });
}

export function createModelRouterPlannerProvider(config = {}) {
  const clean = normalizeFactoryDescriptor(config, "Model router planner", MODEL_PLANNER_FACTORY_KEYS);
  const router = clean.router;
  const id = clean.id ?? "models";
  const label = clean.label ?? "Model router planner";
  const policy = normalizeBoundedModelJsonObject(clean.policy ?? {}, "Model planner routing policy", { maxBytes: PLANNER_FACTORY_JSON_BYTES });
  const contextMode = clean.contextMode ?? "full";
  const semanticContextOptions = normalizeSemanticContextOptions(clean.semanticContextOptions ?? {});
  if (!router || typeof router.execute !== "function") throw new Error("Model router planner requires a router");
  if (!["full", "semantic"].includes(contextMode)) throw new Error(`Unsupported model planner context mode: ${contextMode}`);
  return createPlannerProvider({
    id,
    label,
    capabilities: ["plan", "model-router", contextMode === "semantic" ? "semantic-context" : "full-context"],
    plan: async ({ graph, intent, context }) => {
      const routedContext = contextMode === "semantic"
        ? createPlannerSemanticContext(graph, intent, semanticContextOptions)
        : { graph: createPlannerSnapshot(graph), matches: [] };
      const routed = await router.execute("plan", {
        graph: routedContext.graph,
        intent,
        context,
        semanticMatches: routedContext.matches,
      }, { policy, context: { plannerProviderId: id, contextMode } });
      const result = assertPlannerResult(routed.output);
      return {
        ...result,
        metadata: {
          ...(result.metadata ?? {}),
          routing: {
            backendId: routed.backendId,
            attempts: routed.attempts.slice(0, 32),
            contextMode,
            semanticMatchIds: routedContext.matches.map((match) => match.id).slice(0, 32),
          },
        },
      };
    },
  });
}

export function createModelRouterWorkflowProvider(config = {}) {
  const clean = normalizeFactoryDescriptor(config, "Model router workflow planner", MODEL_PLANNER_FACTORY_KEYS);
  const router = clean.router;
  const id = clean.id ?? "workflow-models";
  const label = clean.label ?? "Model router workflow planner";
  const policy = normalizeBoundedModelJsonObject(clean.policy ?? {}, "Model workflow routing policy", { maxBytes: PLANNER_FACTORY_JSON_BYTES });
  const contextMode = clean.contextMode ?? "semantic";
  const semanticContextOptions = normalizeSemanticContextOptions(clean.semanticContextOptions ?? {});
  if (!router || typeof router.execute !== "function") throw new Error("Model router workflow planner requires a router");
  if (!["full", "semantic"].includes(contextMode)) throw new Error(`Unsupported model workflow context mode: ${contextMode}`);
  return createWorkflowPlannerProvider({
    id,
    label,
    capabilities: ["workflow", "model-router", contextMode === "semantic" ? "semantic-context" : "full-context"],
    proposeWorkflow: async ({ graph, intent, context, signal }) => {
      const routedContext = contextMode === "semantic"
        ? createPlannerSemanticContext(graph, intent, semanticContextOptions)
        : { graph: createPlannerSnapshot(graph), matches: [] };
      const routed = await router.execute("plan-workflow", {
        graph: routedContext.graph,
        intent,
        context,
        semanticMatches: routedContext.matches,
      }, { signal, policy, context: { workflowProviderId: id, contextMode } });
      const result = assertWorkflowPlannerResult(routed.output);
      return {
        ...result,
        metadata: {
          ...(result.metadata ?? {}),
          routing: {
            backendId: routed.backendId,
            attempts: routed.attempts.slice(0, 32),
            contextMode,
            semanticMatchIds: routedContext.matches.map((match) => match.id).slice(0, 32),
          },
        },
      };
    },
  });
}

export class PlannerRegistry {
  #providers = new Map();
  register(provider) {
    const valid = requireProvider(provider);
    if (!this.#providers.has(valid.id) && this.#providers.size >= MAX_PLANNER_PROVIDERS) throw new Error(`Planner registry exceeds ${MAX_PLANNER_PROVIDERS} providers`);
    this.#providers.set(valid.id, valid);
    return this;
  }
  unregister(id) { return this.#providers.delete(id); }
  get(id) { return this.#providers.get(id) ?? null; }
  list() { return [...this.#providers.values()]; }
}

function plannerObjectModelAccess(node) {
  if (node?.kind !== "object") return "full";
  const access = node.props?.permissions?.modelAccess ?? "full";
  return ["full", "metadata", "none"].includes(access) ? access : "none";
}
function plannerVisibleNodeIds(graph) {
  return new Set(Object.values(graph.nodes).filter((node) => plannerObjectModelAccess(node) !== "none").map((node) => node.id));
}
function focusedPlannerNodeIds(graph, visible, focusNodeIds, { neighborDepth = 0, maxNodes = 256 } = {}) {
  const limit = maxNodes;
  const included = new Set();
  if (visible.has(graph.projectId)) included.add(graph.projectId);
  let frontier = [...new Set(focusNodeIds ?? [])].filter((id) => visible.has(id)).sort();
  for (const id of frontier) {
    if (included.size >= limit) break;
    included.add(id);
  }
  const edges = Object.values(graph.edges).sort((a, b) => a.id.localeCompare(b.id));
  const depth = neighborDepth;
  for (let level = 0; level < depth && frontier.length && included.size < limit; level += 1) {
    const next = new Set();
    const expandable = new Set(frontier.filter((id) => id !== graph.projectId));
    for (const edge of edges) {
      let candidate = null;
      if (expandable.has(edge.from)) candidate = edge.to;
      else if (expandable.has(edge.to)) candidate = edge.from;
      if (!candidate || !visible.has(candidate) || included.has(candidate)) continue;
      included.add(candidate);
      if (candidate !== graph.projectId) next.add(candidate);
      if (included.size >= limit) break;
    }
    frontier = [...next].sort();
  }
  return included;
}

export function createPlannerSnapshot(graph, options = {}) {
  const { focusNodeIds, neighborDepth, maxNodes } = normalizePlannerSnapshotOptions(options);
  const visible = plannerVisibleNodeIds(graph);
  const included = focusNodeIds == null ? visible : focusedPlannerNodeIds(graph, visible, focusNodeIds, { neighborDepth, maxNodes });
  const nodes = Object.fromEntries(Object.entries(graph.nodes).filter(([id]) => included.has(id)).map(([id, node]) => {
    const props = { ...(node.props ?? {}) };
    if (node.kind === "asset") {
      delete props.uri;
      delete props.waveform;
    }
    if (node.kind === "object" && plannerObjectModelAccess(node) === "metadata") {
      delete props.semantics;
      delete props.provenance;
      delete props.generationHistory;
      delete props.attributes;
      props.permissions = { modelAccess: "metadata" };
    }
    return [id, { id: node.id, kind: node.kind, name: node.name, props }];
  }));
  const edges = Object.fromEntries(Object.entries(graph.edges).filter(([, edge]) => included.has(edge.from) && included.has(edge.to)).map(([id, edge]) => [id, { id: edge.id, from: edge.from, to: edge.to, type: edge.type, props: { ...(edge.props ?? {}) } }]));
  return { version: graph.version, projectId: graph.projectId, nodes, edges };
}

export function createPlannerSemanticContext(graph, intent, options = {}) {
  const clean = normalizeSemanticContextOptions(options);
  const limit = clean.limit ?? 12;
  const neighborDepth = clean.neighborDepth ?? 1;
  const maxNodes = clean.maxNodes ?? 256;
  const kinds = clean.kinds ?? null;
  const safeGraph = createPlannerSnapshot(graph);
  const searchKinds = kinds ?? ["asset", "composition", "track", "clip", "layer", "effect", "output", "object"];
  const matches = searchSemanticGraph(safeGraph, intent, { limit, kinds: searchKinds });
  const snapshot = createPlannerSnapshot(graph, { focusNodeIds: matches.map((match) => match.id), neighborDepth, maxNodes });
  const included = new Set(Object.keys(snapshot.nodes));
  return { graph: snapshot, matches: matches.filter((match) => included.has(match.id)) };
}

async function readBoundedPlannerResponse(response, maxBytes) {
  const declared = Number(response?.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`Planner response exceeds ${maxBytes} bytes`);
  if (response?.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
        total += chunk.byteLength;
        if (total > maxBytes) {
          await reader.cancel?.("planner-response-too-large");
          throw new Error(`Planner response exceeds ${maxBytes} bytes`);
        }
        chunks.push(chunk);
      }
    } finally { reader.releaseLock?.(); }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  if (typeof response?.text === "function") {
    const text = await response.text();
    if (utf8Bytes(text) > maxBytes) throw new Error(`Planner response exceeds ${maxBytes} bytes`);
    return JSON.parse(text);
  }
  if (typeof response?.json === "function") return response.json();
  throw new Error("Planner response body is unavailable");
}

export function createHttpPlannerProvider(config = {}) {
  const clean = normalizeFactoryDescriptor(config, "HTTP planner", HTTP_PLANNER_FACTORY_KEYS);
  const id = clean.id ?? "http";
  const label = clean.label ?? "HTTP planner";
  const endpoint = clean.endpoint;
  if (typeof endpoint !== "string" || !endpoint.trim()) throw new Error("HTTP planner requires a valid endpoint URL");
  let url;
  try { url = new URL(endpoint); } catch { throw new Error("HTTP planner requires a valid endpoint URL"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("HTTP planner endpoint must use http or https");
  const headers = normalizeHttpPlannerHeaders(clean.headers ?? {});
  const fetchImpl = clean.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("HTTP planner requires fetch support");
  const timeout = strictFactoryNumber(clean.timeoutMs, "HTTP planner timeoutMs", { fallback: 30000, min: 100, max: MAX_HTTP_PLANNER_TIMEOUT_MS });
  const responseLimit = strictFactoryNumber(clean.maxResponseBytes, "HTTP planner maxResponseBytes", { fallback: DEFAULT_PLANNER_RESULT_BYTES, min: 256, max: MAX_HTTP_PLANNER_RESPONSE_BYTES });
  const requestLimit = strictFactoryNumber(clean.maxRequestBytes, "HTTP planner maxRequestBytes", { fallback: DEFAULT_PLANNER_REQUEST_BYTES, min: 256, max: MAX_HTTP_PLANNER_REQUEST_BYTES });
  return createPlannerProvider({
    id,
    label,
    capabilities: ["plan", "remote"],
    plan: async ({ graph, intent, context }) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error(`Planner request timed out after ${timeout}ms`)), timeout);
      try {
        const body = JSON.stringify({ version: 1, intent, context, graph: createPlannerSnapshot(graph) });
        if (utf8Bytes(body) > requestLimit) throw new Error(`Planner request exceeds ${requestLimit} bytes`);
        const response = await fetchImpl(url.href, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body,
          signal: controller.signal,
        });
        if (!response?.ok) throw new Error(`Planner request failed with HTTP ${response?.status ?? "unknown"}`);
        return await readBoundedPlannerResponse(response, responseLimit);
      } finally { clearTimeout(timer); }
    },
  });
}
