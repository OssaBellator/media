import assert from "node:assert/strict";
import test from "node:test";
import {
  addAsset, applyOperations, collectRenderDependencies, createAsset, createMediaProject, createOutputOperations,
  createRenderManifest, deterministicHash, moveClipOperations, nodesByKind, planIntent, renderFrameTimes, stableStringify, updateOutputOperations,
} from "../src/index.js";

function renderProject() {
  let graph = createMediaProject("Deliver");
  graph = addAsset(graph, createAsset({ name: "shot.mp4", mimeType: "video/mp4", duration: 2, hash: "video-hash", size: 42, uri: "memory://shot" }));
  graph = applyOperations(graph, planIntent(graph, "add everything to timeline").operations);
  graph = applyOperations(graph, createOutputOperations(graph, { preset: "web-preview", rangeEnd: 2 }));
  return graph;
}

test("creates delivery outputs as project graph nodes", () => {
  const graph = renderProject();
  const output = nodesByKind(graph, "output")[0];
  assert.equal(output.props.format, "webm");
  assert.equal(output.props.width, 1280);
  assert.equal(output.props.height, 720);
});

test("enumerates deterministic output frame times", () => {
  let graph = renderProject();
  const output = nodesByKind(graph, "output")[0];
  graph = applyOperations(graph, updateOutputOperations(graph, output.id, { fps: 2, rangeStart: 0.5, rangeEnd: 2 }));
  assert.deepEqual(renderFrameTimes(graph.nodes[output.id]), [0.5, 1, 1.5]);
});

test("render manifests include source dependencies and stable signatures", () => {
  const graph = renderProject();
  const output = nodesByKind(graph, "output")[0];
  const deps = collectRenderDependencies(graph, output.id);
  assert.deepEqual(deps.map((item) => item.hash), ["video-hash"]);
  const a = createRenderManifest(graph, output.id);
  const b = createRenderManifest(structuredClone(graph), output.id);
  assert.equal(a.signature, b.signature);
  assert.equal(a.frameCount, 60);
});

test("stable serialization and deterministic hashing ignore object insertion order", () => {
  assert.equal(stableStringify({ b: 2, a: 1 }), stableStringify({ a: 1, b: 2 }));
  assert.equal(deterministicHash({ b: 2, a: 1 }), deterministicHash({ a: 1, b: 2 }));
});


test("render signatures change when edit state changes but remain stable across timestamps", () => {
  let graph = renderProject();
  const output = nodesByKind(graph, "output")[0];
  const clip = nodesByKind(graph, "clip")[0];
  const before = createRenderManifest(graph, output.id).signature;
  const clone = structuredClone(graph);
  clone.nodes[clip.id].updatedAt = "2099-01-01T00:00:00.000Z";
  assert.equal(createRenderManifest(clone, output.id).signature, before);
  graph = applyOperations(graph, moveClipOperations(graph, clip.id, { start: 0.25 }));
  assert.notEqual(createRenderManifest(graph, output.id).signature, before);
});
