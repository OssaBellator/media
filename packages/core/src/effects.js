import { createEdge, createNode, edgesFrom, nodesByKind } from "./graph.js";

export const EFFECT_TYPES = Object.freeze(["brightness", "contrast", "saturation", "blur", "hue", "gain", "pan"]);
const EFFECT_SET = new Set(EFFECT_TYPES);

export function createEffectOperations(graph, targetId, { effectType, name, params = {}, order } = {}) {
  const target = graph.nodes[targetId];
  if (!target || !["layer", "clip"].includes(target.kind)) throw new Error(`Effects cannot target ${targetId}`);
  if (!EFFECT_SET.has(effectType)) throw new Error(`Unsupported effect type: ${effectType}`);
  const effect = createNode({
    kind: "effect",
    name: name || effectType,
    props: { effectType, enabled: true, order: order ?? effectsForTarget(graph, targetId).length, params: { ...params } },
  });
  return [{ type: "node.add", node: effect }, { type: "edge.add", edge: createEdge({ from: effect.id, to: targetId, type: "targets" }) }];
}

export function effectsForTarget(graph, targetId) {
  return nodesByKind(graph, "effect")
    .filter((effect) => edgesFrom(graph, effect.id, "targets").some((edge) => edge.to === targetId))
    .sort((a, b) => Number(a.props.order ?? 0) - Number(b.props.order ?? 0));
}

export function updateEffectOperations(graph, effectId, patch = {}) {
  const effect = graph.nodes[effectId];
  if (!effect || effect.kind !== "effect") throw new Error(`Unknown effect: ${effectId}`);
  const props = {};
  if (patch.enabled !== undefined) props.enabled = Boolean(patch.enabled);
  if (patch.order !== undefined) props.order = Math.max(0, Math.round(Number(patch.order) || 0));
  if (patch.params) props.params = { ...(effect.props.params ?? {}), ...patch.params };
  return [{ type: "node.update", nodeId: effectId, patch: { props } }];
}

export function evaluatedEffects(graph, targetId) {
  return effectsForTarget(graph, targetId).filter((effect) => effect.props.enabled !== false).map((effect) => ({ id: effect.id, type: effect.props.effectType, params: { ...(effect.props.params ?? {}) } }));
}
