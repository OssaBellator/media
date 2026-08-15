import { createAgentPlan } from "./agent-plan.js";
import { canonicalOperationLogJson } from "./operation-log.js";
import { assertValidOperation } from "./operations.js";
import { planIntent } from "./planner.js";
import { searchSemanticGraph } from "./semantic-search.js";

export const MAX_PLANNER_OPERATIONS = 2048;
export const MAX_PLANNER_SUMMARY_CHARS = 4096;
export const DEFAULT_PLANNER_RESULT_BYTES = 2 * 1024 * 1024;
export const DEFAULT_PLANNER_REQUEST_BYTES = 4 * 1024 * 1024;

function utf8Bytes(text) { return new TextEncoder().encode(text).byteLength; }
function boundedPositive(value, fallback, minimum = 256) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum ? Math.floor(number) : fallback;
}
function requireProvider(provider) {
  if (!provider || typeof provider !== "object") throw new Error("Planner provider must be an object");
  if (typeof provider.id !== "string" || !provider.id) throw new Error("Planner provider requires an id");
  if (typeof provider.plan !== "function") throw new Error(`Planner provider ${provider.id} requires a plan function`);
  return provider;
}

export function assertPlannerResult(result, { maxResultBytes = DEFAULT_PLANNER_RESULT_BYTES } = {}) {
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Planner result must be an object");
  if (typeof result.summary !== "string") throw new Error("Planner result requires a summary");
  if (result.summary.length > MAX_PLANNER_SUMMARY_CHARS) throw new Error(`Planner result summary exceeds ${MAX_PLANNER_SUMMARY_CHARS} characters`);
  if (!Array.isArray(result.operations)) throw new Error("Planner result requires an operations array");
  if (result.operations.length > MAX_PLANNER_OPERATIONS) throw new Error(`Planner result exceeds ${MAX_PLANNER_OPERATIONS} operations`);
  result.operations.forEach(assertValidOperation);
  const canonical = canonicalOperationLogJson({ summary: result.summary, operations: result.operations });
  const byteLimit = boundedPositive(maxResultBytes, DEFAULT_PLANNER_RESULT_BYTES);
  if (utf8Bytes(canonical) > byteLimit) throw new Error(`Planner result exceeds ${byteLimit} bytes`);
  return JSON.parse(canonical);
}

export function createPlannerProvider({ id, label = id, capabilities = ["plan"], plan }) {
  return requireProvider({ id, label, capabilities: [...capabilities], plan });
}

export function createLocalPlannerProvider() {
  return createPlannerProvider({ id: "local", label: "Local deterministic planner", capabilities: ["plan", "offline"], plan: async ({ graph, intent }) => planIntent(graph, intent) });
}

export async function planWithProvider(provider, graph, intent, context = {}, options = {}) {
  requireProvider(provider);
  if (typeof intent !== "string" || !intent.trim()) throw new Error("Planner intent must be non-empty");
  const result = await provider.plan({ graph, intent: intent.trim(), context });
  return assertPlannerResult(result, options);
}

export async function proposeWithProvider(provider, graph, intent, context = {}, options = {}) {
  const valid = requireProvider(provider);
  if (typeof intent !== "string" || !intent.trim()) throw new Error("Planner intent must be non-empty");
  const cleanIntent = intent.trim();
  const result = await planWithProvider(valid, graph, cleanIntent, context, options);
  return createAgentPlan(graph, {
    intent: cleanIntent,
    summary: result.summary,
    operations: result.operations,
    providerId: valid.id,
    providerLabel: valid.label ?? valid.id,
    metadata: { providerCapabilities: [...(valid.capabilities ?? [])] },
  });
}

export class PlannerRegistry {
  #providers = new Map();
  register(provider) { const valid = requireProvider(provider); this.#providers.set(valid.id, valid); return this; }
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
  const limit = Math.max(1, Math.min(4096, Math.round(Number(maxNodes) || 256)));
  const included = new Set();
  if (visible.has(graph.projectId)) included.add(graph.projectId);
  let frontier = [...new Set((focusNodeIds ?? []).map(String))].filter((id) => visible.has(id)).sort();
  for (const id of frontier) {
    if (included.size >= limit) break;
    included.add(id);
  }
  const edges = Object.values(graph.edges).sort((a, b) => a.id.localeCompare(b.id));
  const depth = Math.max(0, Math.min(4, Math.round(Number(neighborDepth) || 0)));
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

export function createPlannerSnapshot(graph, { focusNodeIds = null, neighborDepth = 0, maxNodes = 256 } = {}) {
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

export function createPlannerSemanticContext(graph, intent, { limit = 12, neighborDepth = 1, maxNodes = 256, kinds = null } = {}) {
  const safeGraph = createPlannerSnapshot(graph);
  const matches = searchSemanticGraph(safeGraph, intent, { limit, kinds });
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

export function createHttpPlannerProvider({ id = "http", label = "HTTP planner", endpoint, headers = {}, timeoutMs = 30000, maxResponseBytes = DEFAULT_PLANNER_RESULT_BYTES, maxRequestBytes = DEFAULT_PLANNER_REQUEST_BYTES, fetchImpl = globalThis.fetch } = {}) {
  let url;
  try { url = new URL(endpoint); } catch { throw new Error("HTTP planner requires a valid endpoint URL"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("HTTP planner endpoint must use http or https");
  if (typeof fetchImpl !== "function") throw new Error("HTTP planner requires fetch support");
  const timeout = Math.max(100, Number(timeoutMs) || 30000);
  const responseLimit = boundedPositive(maxResponseBytes, DEFAULT_PLANNER_RESULT_BYTES);
  const requestLimit = boundedPositive(maxRequestBytes, DEFAULT_PLANNER_REQUEST_BYTES);
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
