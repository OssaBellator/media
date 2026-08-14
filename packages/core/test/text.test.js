import assert from "node:assert/strict";
import test from "node:test";
import { applyOperations, assertProjectInvariants, createMediaProject, createTextLayerOperations, evaluateComposition, nodesByKind, setKeyframeOperations, updateTextLayerOperations } from "../src/index.js";

test("creates editable text as a first-class composition layer without an asset", () => {
  let graph = createMediaProject("Titles");
  graph = applyOperations(graph, createTextLayerOperations(graph, { text: "Hello world", fontSize: 120, color: "#ffcc00" }));
  const layer = nodesByKind(graph, "layer")[0];
  assert.equal(layer.props.role, "text");
  assert.equal(layer.props.assetId, undefined);
  assert.equal(layer.props.fontSize, 120);
  assert.doesNotThrow(() => assertProjectInvariants(graph));
});

test("text layers remain editable and animatable", () => {
  let graph = createMediaProject("Titles");
  graph = applyOperations(graph, createTextLayerOperations(graph, { text: "One" }));
  const layer = nodesByKind(graph, "layer")[0];
  graph = applyOperations(graph, updateTextLayerOperations(graph, layer.id, { text: "Two", align: "left", fontWeight: 500 }));
  graph = applyOperations(graph, setKeyframeOperations(graph, layer.id, "opacity", { time: 0, value: 0 }));
  graph = applyOperations(graph, setKeyframeOperations(graph, layer.id, "opacity", { time: 1, value: 1 }));
  const plan = evaluateComposition(graph, { time: 0.5 });
  assert.equal(plan.visual[0].kind, "text");
  assert.equal(plan.visual[0].text, "Two");
  assert.equal(plan.visual[0].style.align, "left");
  assert.equal(plan.visual[0].transform.opacity, 0.5);
});
