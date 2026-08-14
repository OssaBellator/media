import assert from "node:assert/strict";
import test from "node:test";
import {
  addAsset,
  applyOperations,
  applyTransaction,
  assertProjectInvariants,
  assertValidGraph,
  collectInvariantViolations,
  commit,
  createAsset,
  createHistory,
  createMediaProject,
  createTransaction,
  deserializeProject,
  nodesByKind,
  parseProjectFile,
  planIntent,
  preflightOperations,
  redo,
  serializeProject,
  undo,
} from "../src/index.js";

function projectWithAssets() {
  let graph = createMediaProject("Campaign");
  graph = addAsset(graph, createAsset({ name: "hero.jpg", mimeType: "image/jpeg", size: 1024, uri: "memory://hero" }));
  graph = addAsset(graph, createAsset({ name: "score.wav", mimeType: "audio/wav", size: 2048, duration: 12, uri: "memory://score" }));
  return graph;
}

test("creates a structurally and semantically valid media project", () => {
  const graph = createMediaProject("Launch film");
  assert.equal(graph.nodes[graph.projectId].name, "Launch film");
  assert.equal(nodesByKind(graph, "composition").length, 1);
  assert.equal(nodesByKind(graph, "track").length, 2);
  assert.doesNotThrow(() => assertValidGraph(graph));
  assert.doesNotThrow(() => assertProjectInvariants(graph));
});

test("adds cross-media assets and plans timeline placement", () => {
  let graph = projectWithAssets();
  const plan = planIntent(graph, "add everything to the timeline");
  assert.equal(plan.operations.length, 6);
  graph = applyOperations(graph, plan.operations);
  assert.equal(nodesByKind(graph, "clip").length, 2);
  assert.equal(new Set(nodesByKind(graph, "clip").map((clip) => clip.props.trackId)).size, 2);
});

test("history makes planner edits reversible", () => {
  const initial = createMediaProject("Landscape");
  let history = createHistory(initial);
  const plan = planIntent(history.present, "make it vertical 9:16");
  history = commit(history, applyOperations(history.present, plan.operations), plan.summary);
  assert.equal(nodesByKind(history.present, "composition")[0].props.width, 1080);
  history = undo(history);
  assert.equal(nodesByKind(history.present, "composition")[0].props.width, 1920);
  history = redo(history);
  assert.equal(nodesByKind(history.present, "composition")[0].props.height, 1920);
});

test("serializes project files in a versioned envelope", () => {
  const graph = createMediaProject("Portable project");
  const serialized = serializeProject(graph, { appVersion: "0.3.0" });
  const file = JSON.parse(serialized);
  assert.equal(file.format, "ossa.media-project");
  assert.equal(file.fileVersion, 1);
  assert.equal(file.metadata.appVersion, "0.3.0");
  assert.deepEqual(deserializeProject(serialized), graph);
});

test("migrates legacy bare-graph project files", () => {
  const graph = createMediaProject("Legacy project");
  const parsed = parseProjectFile(JSON.stringify(graph));
  assert.equal(parsed.migratedFrom, "legacy-bare-graph");
  assert.deepEqual(parsed.graph, graph);
});

test("rejects project files from newer unsupported versions", () => {
  const graph = createMediaProject("Future");
  assert.throws(() => deserializeProject(JSON.stringify({ format: "ossa.media-project", fileVersion: 99, graph })), /newer than supported/);
});

test("preflight rejects malformed operation batches without mutation", () => {
  const graph = createMediaProject("Atomic");
  const original = structuredClone(graph);
  assert.throws(() => preflightOperations(graph, [{ type: "node.update", nodeId: graph.projectId, patch: { name: "Changed" } }, { type: "bogus" }]), /Unsupported operation/);
  assert.deepEqual(graph, original);
});

test("operation diagnostics identify an application failure index", () => {
  const graph = createMediaProject("Diagnostics");
  assert.throws(
    () => applyOperations(graph, [
      { type: "node.update", nodeId: graph.projectId, patch: { name: "Changed" } },
      { type: "node.remove", nodeId: graph.projectId },
    ]),
    (error) => error.name === "OperationBatchError" && error.index === 1 && error.phase === "apply",
  );
});

test("applies named transactions through the same operation boundary", () => {
  const graph = createMediaProject("Transaction");
  const transaction = createTransaction("Rename", [{ type: "node.update", nodeId: graph.projectId, patch: { name: "Renamed" } }]);
  const next = applyTransaction(graph, transaction);
  assert.equal(next.nodes[next.projectId].name, "Renamed");
  assert.equal(graph.nodes[graph.projectId].name, "Transaction");
});

test("semantic invariants catch a clip whose relationship contract is broken", () => {
  let graph = projectWithAssets();
  graph = applyOperations(graph, planIntent(graph, "add everything to timeline").operations);
  const clip = nodesByKind(graph, "clip")[0];
  const broken = structuredClone(graph);
  const containment = Object.values(broken.edges).find((edge) => edge.type === "contains" && edge.to === clip.id);
  delete broken.edges[containment.id];
  const violations = collectInvariantViolations(broken);
  assert.ok(violations.some((violation) => violation.code === "clip.containment"));
  assert.throws(() => assertProjectInvariants(broken), /must be contained/);
});

test("local planner supports aspect ratios, markers and playback-rate edits", () => {
  let graph = projectWithAssets();
  graph = applyOperations(graph, planIntent(graph, "add everything to timeline").operations);
  graph = applyOperations(graph, planIntent(graph, "make it square 1:1").operations);
  assert.equal(nodesByKind(graph, "composition")[0].props.width, 1080);
  graph = applyOperations(graph, planIntent(graph, "add marker Reveal at 3.5s").operations);
  assert.equal(nodesByKind(graph, "layer").find((layer) => layer.props.role === "marker").props.time, 3.5);
  graph = applyOperations(graph, planIntent(graph, "set all clips 2x").operations);
  assert.ok(nodesByKind(graph, "clip").every((clip) => clip.props.playbackRate === 2));
});
