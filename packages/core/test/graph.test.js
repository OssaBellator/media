import assert from "node:assert/strict";
import test from "node:test";
import {
  addAsset,
  applyOperations,
  applyTransaction,
  assertValidGraph,
  commit,
  createAsset,
  createHistory,
  createMediaProject,
  createTransaction,
  deserializeProject,
  moveClipOperations,
  nodesByKind,
  parseProjectFile,
  planIntent,
  redo,
  rippleDeleteClipOperations,
  serializeProject,
  splitClipOperations,
  trimClipOperations,
  undo,
} from "../src/index.js";

function projectWithTimeline(assetCount = 2) {
  let graph = createMediaProject("Timeline test");
  for (let index = 0; index < assetCount; index += 1) {
    graph = addAsset(graph, createAsset({ name: `shot-${index}.mp4`, mimeType: "video/mp4", duration: 6, uri: `memory://shot-${index}` }));
  }
  return applyOperations(graph, planIntent(graph, "add everything to the timeline").operations);
}

test("creates a valid media project with composition and tracks", () => {
  const graph = createMediaProject("Launch film");
  assert.equal(graph.nodes[graph.projectId].name, "Launch film");
  assert.equal(nodesByKind(graph, "composition").length, 1);
  assert.equal(nodesByKind(graph, "track").length, 2);
  assert.doesNotThrow(() => assertValidGraph(graph));
});

test("adds assets to the universal graph and plans timeline placement", () => {
  let graph = createMediaProject("Campaign");
  graph = addAsset(graph, createAsset({ name: "hero.jpg", mimeType: "image/jpeg", size: 1024, uri: "memory://hero" }));
  graph = addAsset(graph, createAsset({ name: "score.wav", mimeType: "audio/wav", size: 2048, uri: "memory://score" }));
  const plan = planIntent(graph, "add everything to the timeline");
  assert.equal(plan.operations.length, 6);
  graph = applyOperations(graph, plan.operations);
  const clips = nodesByKind(graph, "clip");
  assert.equal(clips.length, 2);
  assert.equal(new Set(clips.map((clip) => clip.props.trackId)).size, 2);
  assert.doesNotThrow(() => assertValidGraph(graph));
});

test("planner produces reversible graph edits through history", () => {
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
  const serialized = serializeProject(graph, { appVersion: "0.2.0" });
  const file = JSON.parse(serialized);
  assert.equal(file.format, "ossa.media-project");
  assert.equal(file.fileVersion, 1);
  assert.equal(file.metadata.appVersion, "0.2.0");
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

test("rejects malformed operation batches before mutating", () => {
  const graph = createMediaProject("Atomic");
  const original = structuredClone(graph);
  assert.throws(() => applyOperations(graph, [{ type: "node.update", nodeId: graph.projectId, patch: { name: "Changed" } }, { type: "bogus" }]), /Unsupported operation/);
  assert.deepEqual(graph, original);
});

test("applies a named transaction through the same operation boundary", () => {
  const graph = createMediaProject("Transaction");
  const transaction = createTransaction("Rename", [{ type: "node.update", nodeId: graph.projectId, patch: { name: "Renamed" } }]);
  const next = applyTransaction(graph, transaction);
  assert.equal(next.nodes[next.projectId].name, "Renamed");
  assert.equal(graph.nodes[graph.projectId].name, "Transaction");
});

test("moves and trims a clip with reversible operation data", () => {
  let graph = projectWithTimeline(1);
  const clip = nodesByKind(graph, "clip")[0];
  graph = applyOperations(graph, moveClipOperations(graph, clip.id, { start: 3 }));
  assert.equal(graph.nodes[clip.id].props.start, 3);
  graph = applyOperations(graph, trimClipOperations(graph, clip.id, { edge: "start", time: 4 }));
  assert.equal(graph.nodes[clip.id].props.start, 4);
  assert.equal(graph.nodes[clip.id].props.duration, 5);
  assert.equal(graph.nodes[clip.id].props.inPoint, 1);
  graph = applyOperations(graph, trimClipOperations(graph, clip.id, { edge: "end", time: 8 }));
  assert.equal(graph.nodes[clip.id].props.duration, 4);
});

test("splits a clip while preserving asset and track references", () => {
  let graph = projectWithTimeline(1);
  const original = nodesByKind(graph, "clip")[0];
  graph = applyOperations(graph, splitClipOperations(graph, original.id, 2));
  const clips = nodesByKind(graph, "clip").sort((a, b) => a.props.start - b.props.start);
  assert.equal(clips.length, 2);
  assert.deepEqual(clips.map((clip) => clip.props.duration), [2, 4]);
  assert.equal(clips[1].props.inPoint, 2);
  assert.equal(clips[0].props.assetId, clips[1].props.assetId);
  assert.equal(clips[0].props.trackId, clips[1].props.trackId);
  assert.doesNotThrow(() => assertValidGraph(graph));
});

test("ripple delete closes the gap for later clips on the same track", () => {
  let graph = projectWithTimeline(3);
  const clips = nodesByKind(graph, "clip").sort((a, b) => a.props.start - b.props.start);
  assert.deepEqual(clips.map((clip) => clip.props.start), [0, 6, 12]);
  graph = applyOperations(graph, rippleDeleteClipOperations(graph, clips[1].id));
  const remaining = nodesByKind(graph, "clip").sort((a, b) => a.props.start - b.props.start);
  assert.deepEqual(remaining.map((clip) => clip.props.start), [0, 6]);
});

test("rejects dangling edges during validation", () => {
  const graph = createMediaProject("Broken");
  graph.edges.bad = { id: "bad", from: graph.projectId, to: "missing", type: "contains", props: {} };
  assert.throws(() => assertValidGraph(graph), /Dangling edge/);
});
