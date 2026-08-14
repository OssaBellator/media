import { assertValidOperation } from "./operations.js";
import { planIntent } from "./planner.js";

function requireProvider(provider) {
  if (!provider || typeof provider !== "object") throw new Error("Planner provider must be an object");
  if (typeof provider.id !== "string" || !provider.id) throw new Error("Planner provider requires an id");
  if (typeof provider.plan !== "function") throw new Error(`Planner provider ${provider.id} requires a plan function`);
  return provider;
}

export function assertPlannerResult(result) {
  if (!result || typeof result !== "object") throw new Error("Planner result must be an object");
  if (typeof result.summary !== "string") throw new Error("Planner result requires a summary");
  if (!Array.isArray(result.operations)) throw new Error("Planner result requires an operations array");
  result.operations.forEach(assertValidOperation);
  return result;
}

export function createPlannerProvider({ id, label = id, capabilities = ["plan"], plan }) {
  return requireProvider({ id, label, capabilities: [...capabilities], plan });
}

export function createLocalPlannerProvider() {
  return createPlannerProvider({ id: "local", label: "Local deterministic planner", capabilities: ["plan", "offline"], plan: async ({ graph, intent }) => planIntent(graph, intent) });
}

export async function planWithProvider(provider, graph, intent, context = {}) {
  requireProvider(provider);
  if (typeof intent !== "string" || !intent.trim()) throw new Error("Planner intent must be non-empty");
  const result = await provider.plan({ graph, intent: intent.trim(), context });
  return assertPlannerResult(result);
}

export class PlannerRegistry {
  #providers = new Map();
  register(provider) { const valid = requireProvider(provider); this.#providers.set(valid.id, valid); return this; }
  unregister(id) { return this.#providers.delete(id); }
  get(id) { return this.#providers.get(id) ?? null; }
  list() { return [...this.#providers.values()]; }
}

export function createPlannerSnapshot(graph) {
  const nodes = Object.fromEntries(Object.entries(graph.nodes).map(([id, node]) => {
    const props = { ...(node.props ?? {}) };
    if (node.kind === "asset") {
      delete props.uri;
      delete props.waveform;
    }
    return [id, { id: node.id, kind: node.kind, name: node.name, props }];
  }));
  const edges = Object.fromEntries(Object.entries(graph.edges).map(([id, edge]) => [id, { id: edge.id, from: edge.from, to: edge.to, type: edge.type, props: { ...(edge.props ?? {}) } }]));
  return { version: graph.version, projectId: graph.projectId, nodes, edges };
}

export function createHttpPlannerProvider({ id = "http", label = "HTTP planner", endpoint, headers = {}, timeoutMs = 30000, fetchImpl = globalThis.fetch } = {}) {
  let url;
  try { url = new URL(endpoint); } catch { throw new Error("HTTP planner requires a valid endpoint URL"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("HTTP planner endpoint must use http or https");
  if (typeof fetchImpl !== "function") throw new Error("HTTP planner requires fetch support");
  const timeout = Math.max(100, Number(timeoutMs) || 30000);
  return createPlannerProvider({
    id,
    label,
    capabilities: ["plan", "remote"],
    plan: async ({ graph, intent, context }) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error(`Planner request timed out after ${timeout}ms`)), timeout);
      try {
        const response = await fetchImpl(url.href, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify({ version: 1, intent, context, graph: createPlannerSnapshot(graph) }),
          signal: controller.signal,
        });
        if (!response?.ok) throw new Error(`Planner request failed with HTTP ${response?.status ?? "unknown"}`);
        return await response.json();
      } finally { clearTimeout(timer); }
    },
  });
}
