import { createEdge, createNode, nodesByKind } from "./graph.js";

const EPSILON = 0.001;

function number(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a finite number`);
  return parsed;
}

function clipFromGraph(graph, clipId) {
  const clip = graph.nodes[clipId];
  if (!clip || clip.kind !== "clip") throw new Error(`Unknown clip: ${clipId}`);
  return clip;
}

function trackFromGraph(graph, trackId) {
  const track = graph.nodes[trackId];
  if (!track || track.kind !== "track") throw new Error(`Unknown track: ${trackId}`);
  return track;
}

function assertCompatibleTrack(graph, clip, trackId) {
  const track = trackFromGraph(graph, trackId);
  const asset = graph.nodes[clip.props.assetId];
  const audioAsset = ["audio", "music"].includes(asset?.props.mediaKind);
  const wanted = audioAsset ? "audio" : "visual";
  if (track.props.mediaKind !== wanted) throw new Error(`Clip ${clip.id} is not compatible with ${track.name}`);
  return track;
}

export function clipEnd(clip) {
  return Number(clip.props.start ?? 0) + Number(clip.props.duration ?? 0);
}

export function moveClipOperations(graph, clipId, { start, trackId } = {}) {
  const clip = clipFromGraph(graph, clipId);
  const nextStart = Math.max(0, number(start ?? clip.props.start, "Clip start"));
  const nextTrackId = trackId ?? clip.props.trackId;
  assertCompatibleTrack(graph, clip, nextTrackId);
  const operations = [{ type: "node.update", nodeId: clip.id, patch: { props: { start: nextStart, trackId: nextTrackId } } }];
  if (nextTrackId !== clip.props.trackId) {
    const containment = Object.values(graph.edges).find((edge) => edge.type === "contains" && edge.to === clip.id && edge.from === clip.props.trackId);
    if (containment) operations.push({ type: "edge.remove", edgeId: containment.id });
    operations.push({ type: "edge.add", edge: createEdge({ from: nextTrackId, to: clip.id }) });
  }
  return operations;
}

export function trimClipOperations(graph, clipId, { edge, time }) {
  const clip = clipFromGraph(graph, clipId);
  const start = Number(clip.props.start ?? 0);
  const duration = Number(clip.props.duration ?? 0);
  const end = start + duration;
  const inPoint = Number(clip.props.inPoint ?? 0);
  const target = number(time, "Trim time");
  if (edge === "start") {
    if (target < 0 || target >= end - EPSILON) throw new Error("Trim start must remain before clip end");
    const delta = target - start;
    const nextDuration = duration - delta;
    if (nextDuration <= EPSILON || inPoint + delta < 0) throw new Error("Trim start is outside available media");
    return [{ type: "node.update", nodeId: clip.id, patch: { props: { start: target, duration: nextDuration, inPoint: inPoint + delta } } }];
  }
  if (edge === "end") {
    if (target <= start + EPSILON) throw new Error("Trim end must remain after clip start");
    return [{ type: "node.update", nodeId: clip.id, patch: { props: { duration: target - start } } }];
  }
  throw new Error(`Unsupported trim edge: ${edge}`);
}

export function splitClipOperations(graph, clipId, time) {
  const clip = clipFromGraph(graph, clipId);
  const start = Number(clip.props.start ?? 0);
  const end = clipEnd(clip);
  const splitTime = number(time, "Split time");
  if (splitTime <= start + EPSILON || splitTime >= end - EPSILON) throw new Error("Split time must be inside the clip");
  const firstDuration = splitTime - start;
  const secondDuration = end - splitTime;
  const second = createNode({
    kind: "clip",
    name: `${clip.name} (split)`,
    props: {
      ...clip.props,
      start: splitTime,
      duration: secondDuration,
      inPoint: Number(clip.props.inPoint ?? 0) + firstDuration * Number(clip.props.playbackRate ?? 1),
    },
  });
  return [
    { type: "node.update", nodeId: clip.id, patch: { props: { duration: firstDuration } } },
    { type: "node.add", node: second },
    { type: "edge.add", edge: createEdge({ from: clip.props.trackId, to: second.id }) },
    { type: "edge.add", edge: createEdge({ from: second.id, to: clip.props.assetId, type: "references" }) },
  ];
}

export function rippleDeleteClipOperations(graph, clipId) {
  const clip = clipFromGraph(graph, clipId);
  const start = Number(clip.props.start ?? 0);
  const end = clipEnd(clip);
  const duration = Number(clip.props.duration ?? 0);
  const later = nodesByKind(graph, "clip")
    .filter((candidate) => candidate.id !== clip.id && candidate.props.trackId === clip.props.trackId && Number(candidate.props.start ?? 0) >= end - EPSILON)
    .sort((a, b) => Number(a.props.start) - Number(b.props.start));
  return [
    { type: "node.remove", nodeId: clip.id },
    ...later.map((candidate) => ({
      type: "node.update",
      nodeId: candidate.id,
      patch: { props: { start: Math.max(start, Number(candidate.props.start ?? 0) - duration) } },
    })),
  ];
}

export function timelineDuration(graph, minimum = 0) {
  return nodesByKind(graph, "clip").reduce((max, clip) => Math.max(max, clipEnd(clip)), Number(minimum));
}
