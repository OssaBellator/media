import assert from "node:assert/strict";
import test from "node:test";
import { applyOperations, createMediaProject, createShapeLayerOperations, evaluateComposition, nodesByKind, setKeyframeOperations, updateShapeLayerOperations } from "../src/index.js";

test("creates native vector shape layers", () => {
  let graph = createMediaProject("Shapes");
  graph = applyOperations(graph, createShapeLayerOperations(graph, { shapeType: "ellipse", width: 320, height: 180, fill: "#ff00aa" }));
  const layer = nodesByKind(graph, "layer")[0];
  assert.equal(layer.props.role, "shape");
  assert.equal(layer.props.assetId, undefined);
  const plan = evaluateComposition(graph, { time: 0 });
  assert.equal(plan.visual[0].kind, "shape");
  assert.equal(plan.visual[0].shape.type, "ellipse");
});

test("shape style stays editable and transform animation remains shared", () => {
  let graph = createMediaProject("Shapes");
  graph = applyOperations(graph, createShapeLayerOperations(graph));
  const layer = nodesByKind(graph, "layer")[0];
  graph = applyOperations(graph, updateShapeLayerOperations(graph, layer.id, { fill: "#123456", width: 900, cornerRadius: 80 }));
  graph = applyOperations(graph, setKeyframeOperations(graph, layer.id, "rotation", { time: 0, value: 0 }));
  graph = applyOperations(graph, setKeyframeOperations(graph, layer.id, "rotation", { time: 2, value: 90 }));
  const item = evaluateComposition(graph, { time: 1 }).visual[0];
  assert.equal(item.shape.fill, "#123456");
  assert.equal(item.shape.width, 900);
  assert.equal(item.transform.rotation, 45);
});
