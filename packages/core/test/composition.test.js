import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TRANSFORM,
  addAsset,
  applyOperations,
  createAsset,
  createLayerForAssetOperations,
  createMediaProject,
  evaluateComposition,
  nodesByKind,
  normalizeTransform,
  planIntent,
  resetTransformOperations,
  sourceTimeForClip,
  transformNodeOperations,
} from "../src/index.js";

function visualProject() {
  let graph = createMediaProject("Visual");
  graph = addAsset(graph, createAsset({ name: "hero.png", mimeType: "image/png", width: 1600, height: 900, uri: "memory://hero" }));
  graph = addAsset(graph, createAsset({ name: "shot.mp4", mimeType: "video/mp4", width: 1920, height: 1080, duration: 10, uri: "memory://shot" }));
  return graph;
}

test("normalizes transforms and clamps bounded properties", () => {
  const transform = normalizeTransform({ x: "12", opacity: 2, anchorX: -2, rotation: 45 });
  assert.equal(transform.x, 12);
  assert.equal(transform.opacity, 1);
  assert.equal(transform.anchorX, 0);
  assert.equal(transform.rotation, 45);
});

test("creates a visual Canvas layer that references a shared asset", () => {
  let graph = visualProject();
  const asset = nodesByKind(graph, "asset")[0];
  graph = applyOperations(graph, createLayerForAssetOperations(graph, asset.id));
  const layer = nodesByKind(graph, "layer")[0];
  assert.equal(layer.props.assetId, asset.id);
  assert.deepEqual(layer.props.transform, DEFAULT_TRANSFORM);
});

test("applies and resets nondestructive Canvas transforms", () => {
  let graph = visualProject();
  graph = applyOperations(graph, createLayerForAssetOperations(graph, nodesByKind(graph, "asset")[0].id));
  const layer = nodesByKind(graph, "layer")[0];
  graph = applyOperations(graph, transformNodeOperations(graph, layer.id, { x: 120, y: -40, rotation: 12, scaleX: 1.2, scaleY: 1.2, opacity: 0.7 }));
  assert.equal(graph.nodes[layer.id].props.transform.x, 120);
  assert.equal(graph.nodes[layer.id].props.transform.opacity, 0.7);
  graph = applyOperations(graph, resetTransformOperations(graph, layer.id));
  assert.deepEqual(graph.nodes[layer.id].props.transform, DEFAULT_TRANSFORM);
});

test("rejects invalid crop and zero-scale transforms", () => {
  let graph = visualProject();
  graph = applyOperations(graph, createLayerForAssetOperations(graph, nodesByKind(graph, "asset")[0].id));
  const layer = nodesByKind(graph, "layer")[0];
  assert.throws(() => transformNodeOperations(graph, layer.id, { scaleX: 0 }), /scale cannot be zero/);
  assert.throws(() => transformNodeOperations(graph, layer.id, { cropLeft: 0.6, cropRight: 0.5 }), /Crop cannot remove/);
});

test("evaluates Canvas layers and timeline clips into one render plan", () => {
  let graph = visualProject();
  const [image, video] = nodesByKind(graph, "asset");
  graph = applyOperations(graph, createLayerForAssetOperations(graph, image.id));
  graph = applyOperations(graph, planIntent(graph, "add everything to timeline").operations);
  const plan = evaluateComposition(graph, { time: 2 });
  assert.equal(plan.width, 1920);
  assert.ok(plan.visual.some((item) => item.kind === "layer" && item.assetId === image.id));
  assert.ok(plan.visual.some((item) => item.kind === "clip"));
  assert.equal(plan.audio.length, 0);
  const videoClip = nodesByKind(graph, "clip").find((clip) => clip.props.assetId === video.id);
  assert.equal(sourceTimeForClip(videoClip, Number(videoClip.props.start) + 2), 2);
});
