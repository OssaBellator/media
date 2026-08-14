import assert from "node:assert/strict";
import test from "node:test";
import {
  addAsset,
  applyOperations,
  assertValidGraph,
  commit,
  createAsset,
  createHistory,
  createMediaProject,
  deserializeProject,
  nodesByKind,
  planIntent,
  redo,
  serializeProject,
  undo,
} from "../src/index.js";

test("creates a valid media project with composition and tracks", () => {
  const graph = createMediaProject("Launch film");
  assert.equal(graph.nodes[graph.projectId].name, "Launch film");
  assert.equal(nodesByKind(graph, "composition").length, 1);
  assert.equal(nodesByKind(graph, "track").length, 2);
  assert.doesNotThrow(() => assertValidGraph(graph));
});

test("adds assets to the universal graph and plans timeline placement", () => {
  let graph = createMediaProject("Campaign");
  graph = addAsset(
    graph,
    createAsset({ name: "hero.jpg", mimeType: "image/jpeg", size: 1024, uri: "memory://hero" }),
  );
  graph = addAsset(
    graph,
    createAsset({ name: "score.wav", mimeType: "audio/wav", size: 2048, uri: "memory://score" }),
  );

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
  const vertical = applyOperations(history.present, plan.operations);
  history = commit(history, vertical, plan.summary);

  assert.equal(nodesByKind(history.present, "composition")[0].props.width, 1080);
  history = undo(history);
  assert.equal(nodesByKind(history.present, "composition")[0].props.width, 1920);
  history = redo(history);
  assert.equal(nodesByKind(history.present, "composition")[0].props.height, 1920);
});

test("serializes and validates project files", () => {
  const graph = createMediaProject("Portable project");
  const roundTrip = deserializeProject(serializeProject(graph));
  assert.deepEqual(roundTrip, graph);
});

test("rejects dangling edges during validation", () => {
  const graph = createMediaProject("Broken");
  graph.edges.bad = { id: "bad", from: graph.projectId, to: "missing", type: "contains", props: {} };
  assert.throws(() => assertValidGraph(graph), /Dangling edge/);
});
