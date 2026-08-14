import assert from "node:assert/strict";
import test from "node:test";
import {
  addAsset,
  applyOperations,
  createAsset,
  createEffectOperations,
  createLayerForAssetOperations,
  createMediaProject,
  evaluateAnimatedTransform,
  evaluateComposition,
  evaluateKeyframes,
  evaluatedEffects,
  keyframeSummary,
  nodesByKind,
  removeKeyframeOperations,
  setKeyframeOperations,
  updateEffectOperations,
} from "../src/index.js";

function layerProject() {
  let graph = createMediaProject("Animation");
  const asset = createAsset({ name: "hero.png", mimeType: "image/png", uri: "memory://hero" });
  graph = addAsset(graph, asset);
  graph = applyOperations(graph, createLayerForAssetOperations(graph, asset.id));
  return graph;
}

test("interpolates numeric keyframes with easing", () => {
  let graph = layerProject();
  const layer = nodesByKind(graph, "layer")[0];
  graph = applyOperations(graph, setKeyframeOperations(graph, layer.id, "x", { time: 0, value: 0, easing: "linear" }));
  graph = applyOperations(graph, setKeyframeOperations(graph, layer.id, "x", { time: 10, value: 100 }));
  assert.equal(evaluateKeyframes(graph.nodes[layer.id], "x", 5), 50);
  assert.equal(evaluateAnimatedTransform(graph.nodes[layer.id], 2.5).x, 25);
});

test("replaces keyframes at the same time and can remove them", () => {
  let graph = layerProject();
  const layer = nodesByKind(graph, "layer")[0];
  graph = applyOperations(graph, setKeyframeOperations(graph, layer.id, "rotation", { time: 2, value: 15 }));
  graph = applyOperations(graph, setKeyframeOperations(graph, layer.id, "rotation", { time: 2, value: 30 }));
  assert.deepEqual(keyframeSummary(graph.nodes[layer.id]), [{ property: "rotation", count: 1 }]);
  assert.equal(evaluateKeyframes(graph.nodes[layer.id], "rotation", 2), 30);
  graph = applyOperations(graph, removeKeyframeOperations(graph, layer.id, "rotation", 2));
  assert.deepEqual(keyframeSummary(graph.nodes[layer.id]), []);
});

test("creates ordered nondestructive effect stacks", () => {
  let graph = layerProject();
  const layer = nodesByKind(graph, "layer")[0];
  graph = applyOperations(graph, createEffectOperations(graph, layer.id, { effectType: "brightness", params: { amount: 1.2 } }));
  graph = applyOperations(graph, createEffectOperations(graph, layer.id, { effectType: "blur", params: { radius: 8 } }));
  let effects = evaluatedEffects(graph, layer.id);
  assert.deepEqual(effects.map((effect) => effect.type), ["brightness", "blur"]);
  graph = applyOperations(graph, updateEffectOperations(graph, effects[0].id, { enabled: false }));
  effects = evaluatedEffects(graph, layer.id);
  assert.deepEqual(effects.map((effect) => effect.type), ["blur"]);
});

test("composition evaluation includes animated values and effect stacks", () => {
  let graph = layerProject();
  const layer = nodesByKind(graph, "layer")[0];
  graph = applyOperations(graph, setKeyframeOperations(graph, layer.id, "opacity", { time: 0, value: 0 }));
  graph = applyOperations(graph, setKeyframeOperations(graph, layer.id, "opacity", { time: 2, value: 1 }));
  graph = applyOperations(graph, createEffectOperations(graph, layer.id, { effectType: "contrast", params: { amount: 1.1 } }));
  const plan = evaluateComposition(graph, { time: 1 });
  assert.equal(plan.visual[0].transform.opacity, 0.5);
  assert.equal(plan.visual[0].effects[0].type, "contrast");
});
