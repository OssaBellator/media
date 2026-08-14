import assert from "node:assert/strict";
import test from "node:test";
import {
  addAsset,
  applyOperations,
  createAsset,
  createTrackOperations,
  createMediaProject,
  findTimelineOverlaps,
  insertAssetOperations,
  moveClipOperations,
  nodesByKind,
  planIntent,
  rippleDeleteClipOperations,
  setPlaybackRateOperations,
  setTrackStateOperations,
  slipClipOperations,
  snapTimelineTime,
  splitClipOperations,
  timelineSnapPoints,
  trimClipOperations,
} from "../src/index.js";

function projectWithTimeline(assetCount = 3, duration = 6) {
  let graph = createMediaProject("Timeline test");
  for (let index = 0; index < assetCount; index += 1) graph = addAsset(graph, createAsset({ name: `shot-${index}.mp4`, mimeType: "video/mp4", duration, uri: `memory://shot-${index}` }));
  return applyOperations(graph, planIntent(graph, "add everything to the timeline").operations);
}

test("moves and trims a clip while preserving source timing", () => {
  let graph = projectWithTimeline(1);
  const clip = nodesByKind(graph, "clip")[0];
  graph = applyOperations(graph, moveClipOperations(graph, clip.id, { start: 3 }));
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
  assert.deepEqual(clips.map((clip) => clip.props.duration), [2, 4]);
  assert.equal(clips[1].props.inPoint, 2);
  assert.equal(clips[0].props.assetId, clips[1].props.assetId);
});

test("ripple delete closes gaps on the edited track", () => {
  let graph = projectWithTimeline(3);
  const clips = nodesByKind(graph, "clip").sort((a, b) => a.props.start - b.props.start);
  graph = applyOperations(graph, rippleDeleteClipOperations(graph, clips[1].id));
  assert.deepEqual(nodesByKind(graph, "clip").sort((a, b) => a.props.start - b.props.start).map((clip) => clip.props.start), [0, 6]);
});

test("snaps a time to nearby clip boundaries", () => {
  const graph = projectWithTimeline(2);
  const clips = nodesByKind(graph, "clip").sort((a, b) => a.props.start - b.props.start);
  const points = timelineSnapPoints(graph, { trackId: clips[0].props.trackId, excludeClipId: clips[0].id });
  assert.ok(points.some((point) => point.time === 6));
  const snapped = snapTimelineTime(graph, 5.88, { trackId: clips[0].props.trackId, excludeClipId: clips[0].id, tolerance: 0.2 });
  assert.equal(snapped.time, 6);
  assert.equal(snapped.snapped, true);
});

test("move operations can snap directly to an adjacent edit point", () => {
  let graph = projectWithTimeline(2);
  const clips = nodesByKind(graph, "clip").sort((a, b) => a.props.start - b.props.start);
  graph = applyOperations(graph, moveClipOperations(graph, clips[0].id, { start: 5.9, snap: true, tolerance: 0.2 }));
  assert.equal(graph.nodes[clips[0].id].props.start, 6);
});

test("ripple insert shifts later clips and inserts the asset", () => {
  let graph = projectWithTimeline(2);
  const third = createAsset({ name: "insert.mp4", mimeType: "video/mp4", duration: 2, uri: "memory://insert" });
  graph = addAsset(graph, third);
  const trackId = nodesByKind(graph, "track").find((track) => track.props.mediaKind === "visual").id;
  graph = applyOperations(graph, insertAssetOperations(graph, third.id, { start: 6, trackId, ripple: true, snap: false }));
  const clips = nodesByKind(graph, "clip").filter((clip) => clip.props.trackId === trackId).sort((a, b) => a.props.start - b.props.start);
  assert.deepEqual(clips.map((clip) => clip.props.start), [0, 6, 8]);
  assert.equal(clips[1].props.assetId, third.id);
});

test("slips source media without moving the timeline clip", () => {
  let graph = projectWithTimeline(1, 10);
  const clip = nodesByKind(graph, "clip")[0];
  graph = applyOperations(graph, trimClipOperations(graph, clip.id, { edge: "end", time: 5 }));
  graph = applyOperations(graph, slipClipOperations(graph, clip.id, { delta: 2 }));
  assert.equal(graph.nodes[clip.id].props.start, 0);
  assert.equal(graph.nodes[clip.id].props.duration, 5);
  assert.equal(graph.nodes[clip.id].props.inPoint, 2);
  assert.throws(() => slipClipOperations(graph, clip.id, { delta: 10 }), /exceeds source duration/);
});

test("playback rate preserves source range by default", () => {
  let graph = projectWithTimeline(1, 8);
  const clip = nodesByKind(graph, "clip")[0];
  graph = applyOperations(graph, setPlaybackRateOperations(graph, clip.id, 2));
  assert.equal(graph.nodes[clip.id].props.playbackRate, 2);
  assert.equal(graph.nodes[clip.id].props.duration, 4);
});

test("detects overlaps after a non-ripple move", () => {
  let graph = projectWithTimeline(2);
  const clips = nodesByKind(graph, "clip").sort((a, b) => a.props.start - b.props.start);
  graph = applyOperations(graph, moveClipOperations(graph, clips[1].id, { start: 4 }));
  assert.deepEqual(findTimelineOverlaps(graph, clips[0].props.trackId), [[clips[0].id, clips[1].id]]);
});


test("creates additional tracks and enforces track locks", () => {
  let graph = projectWithTimeline(1);
  graph = applyOperations(graph, createTrackOperations(graph, { mediaKind: "visual" }));
  const visualTracks = nodesByKind(graph, "track").filter((track) => track.props.mediaKind === "visual");
  assert.equal(visualTracks.length, 2);
  const clip = nodesByKind(graph, "clip")[0];
  graph = applyOperations(graph, setTrackStateOperations(graph, clip.props.trackId, { locked: true }));
  assert.throws(() => moveClipOperations(graph, clip.id, { start: 2 }), /locked/);
});

test("mute and lock state are graph operations rather than UI-only flags", () => {
  let graph = projectWithTimeline(1);
  const track = nodesByKind(graph, "track").find((item) => item.props.mediaKind === "visual");
  graph = applyOperations(graph, setTrackStateOperations(graph, track.id, { muted: true, locked: true }));
  assert.equal(graph.nodes[track.id].props.muted, true);
  assert.equal(graph.nodes[track.id].props.locked, true);
});
