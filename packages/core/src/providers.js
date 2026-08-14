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
