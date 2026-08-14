import { createEdge, nodesByKind } from "./graph.js";
import { createClipForAsset } from "./project.js";

const EPSILON = 0.001;
export const DEFAULT_SNAP_TOLERANCE = 0.2;

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
  if (track.props.mediaKind !== (audioAsset ? "audio" : "visual")) throw new Error(`Clip ${clip.id} is not compatible with ${track.name}`);
  if (track.props.locked) throw new Error(`Track ${track.name} is locked`);
  return track;
}

export function clipEnd(clip) { return Number(clip.props.start ?? 0) + Number(clip.props.duration ?? 0); }
export function clipsOnTrack(graph, trackId) { return nodesByKind(graph, "clip").filter((clip) => clip.props.trackId === trackId).sort((a, b) => Number(a.props.start) - Number(b.props.start)); }

export function timelineDuration(graph, minimum = 0) { return nodesByKind(graph, "clip").reduce((max, clip) => Math.max(max, clipEnd(clip)), Number(minimum)); }

export function timelineSnapPoints(graph, { trackId, excludeClipId, includeMarkers = true } = {}) {
  const points = [{ time: 0, kind: "origin", nodeId: null }];
  for (const clip of nodesByKind(graph, "clip")) {
    if (clip.id === excludeClipId || (trackId && clip.props.trackId !== trackId)) continue;
    points.push({ time: Number(clip.props.start ?? 0), kind: "clip-start", nodeId: clip.id });
    points.push({ time: clipEnd(clip), kind: "clip-end", nodeId: clip.id });
  }
  if (includeMarkers) {
    for (const layer of nodesByKind(graph, "layer")) {
      if (layer.props.role === "marker" && Number.isFinite(Number(layer.props.time))) points.push({ time: Number(layer.props.time), kind: "marker", nodeId: layer.id });
    }
  }
  return points.sort((a, b) => a.time - b.time);
}

export function snapTimelineTime(graph, rawTime, { trackId, excludeClipId, tolerance = DEFAULT_SNAP_TOLERANCE, points } = {}) {
  const time = Math.max(0, number(rawTime, "Timeline time"));
  const candidates = points ?? timelineSnapPoints(graph, { trackId, excludeClipId });
  let nearest = null;
  for (const point of candidates) {
    const distance = Math.abs(point.time - time);
    if (distance <= tolerance && (!nearest || distance < nearest.distance)) nearest = { ...point, distance };
  }
  return nearest ? { time: nearest.time, snapped: true, target: nearest } : { time, snapped: false, target: null };
}

export function moveClipOperations(graph, clipId, { start, trackId, snap = false, tolerance = DEFAULT_SNAP_TOLERANCE } = {}) {
  const clip = clipFromGraph(graph, clipId);
  const nextTrackId = trackId ?? clip.props.trackId;
  assertCompatibleTrack(graph, clip, nextTrackId);
  const requested = Math.max(0, number(start ?? clip.props.start, "Clip start"));
  const nextStart = snap ? snapTimelineTime(graph, requested, { trackId: nextTrackId, excludeClipId: clip.id, tolerance }).time : requested;
  const operations = [{ type: "node.update", nodeId: clip.id, patch: { props: { start: nextStart, trackId: nextTrackId } } }];
  if (nextTrackId !== clip.props.trackId) {
    const containment = Object.values(graph.edges).find((edge) => edge.type === "contains" && edge.to === clip.id && edge.from === clip.props.trackId);
    if (containment) operations.push({ type: "edge.remove", edgeId: containment.id });
    operations.push({ type: "edge.add", edge: createEdge({ from: nextTrackId, to: clip.id }) });
  }
  return operations;
}

export function trimClipOperations(graph, clipId, { edge, time, snap = false, tolerance = DEFAULT_SNAP_TOLERANCE }) {
  const clip = clipFromGraph(graph, clipId);
  assertCompatibleTrack(graph, clip, clip.props.trackId);
  const start = Number(clip.props.start ?? 0);
  const duration = Number(clip.props.duration ?? 0);
  const end = start + duration;
  const inPoint = Number(clip.props.inPoint ?? 0);
  const requested = number(time, "Trim time");
  const target = snap ? snapTimelineTime(graph, requested, { trackId: clip.props.trackId, excludeClipId: clip.id, tolerance }).time : requested;
  if (edge === "start") {
    if (target < 0 || target >= end - EPSILON) throw new Error("Trim start must remain before clip end");
    const delta = target - start;
    const nextDuration = duration - delta;
    if (nextDuration <= EPSILON || inPoint + delta * Number(clip.props.playbackRate ?? 1) < 0) throw new Error("Trim start is outside available media");
    return [{ type: "node.update", nodeId: clip.id, patch: { props: { start: target, duration: nextDuration, inPoint: inPoint + delta * Number(clip.props.playbackRate ?? 1) } } }];
  }
  if (edge === "end") {
    if (target <= start + EPSILON) throw new Error("Trim end must remain after clip start");
    return [{ type: "node.update", nodeId: clip.id, patch: { props: { duration: target - start } } }];
  }
  throw new Error(`Unsupported trim edge: ${edge}`);
}

export function splitClipOperations(graph, clipId, time) {
  const clip = clipFromGraph(graph, clipId);
  assertCompatibleTrack(graph, clip, clip.props.trackId);
  const start = Number(clip.props.start ?? 0);
  const end = clipEnd(clip);
  const splitTime = number(time, "Split time");
  if (splitTime <= start + EPSILON || splitTime >= end - EPSILON) throw new Error("Split time must be inside the clip");
  const firstDuration = splitTime - start;
  const secondDuration = end - splitTime;
  const { clip: second, edges } = createClipForAsset(graph, graph.nodes[clip.props.assetId], splitTime, clip.props.trackId);
  second.name = `${clip.name} (split)`;
  second.props = { ...second.props, ...clip.props, start: splitTime, duration: secondDuration, inPoint: Number(clip.props.inPoint ?? 0) + firstDuration * Number(clip.props.playbackRate ?? 1) };
  return [
    { type: "node.update", nodeId: clip.id, patch: { props: { duration: firstDuration } } },
    { type: "node.add", node: second },
    ...edges.map((edge) => ({ type: "edge.add", edge })),
  ];
}

export function rippleDeleteClipOperations(graph, clipId) {
  const clip = clipFromGraph(graph, clipId);
  assertCompatibleTrack(graph, clip, clip.props.trackId);
  const start = Number(clip.props.start ?? 0);
  const end = clipEnd(clip);
  const duration = Number(clip.props.duration ?? 0);
  const later = clipsOnTrack(graph, clip.props.trackId).filter((candidate) => candidate.id !== clip.id && Number(candidate.props.start ?? 0) >= end - EPSILON);
  return [
    { type: "node.remove", nodeId: clip.id },
    ...later.map((candidate) => ({ type: "node.update", nodeId: candidate.id, patch: { props: { start: Math.max(start, Number(candidate.props.start ?? 0) - duration) } } })),
  ];
}

export function insertAssetOperations(graph, assetId, { start = 0, trackId, ripple = false, snap = true, tolerance = DEFAULT_SNAP_TOLERANCE } = {}) {
  const asset = graph.nodes[assetId];
  if (!asset || asset.kind !== "asset") throw new Error(`Unknown asset: ${assetId}`);
  const preview = createClipForAsset(graph, asset, 0, trackId);
  const targetTrack = preview.clip.props.trackId;
  const requestedStart = Math.max(0, number(start, "Insert start"));
  const insertStart = snap ? snapTimelineTime(graph, requestedStart, { trackId: targetTrack, tolerance }).time : requestedStart;
  preview.clip.props.start = insertStart;
  const duration = Number(preview.clip.props.duration);
  const shifts = ripple ? clipsOnTrack(graph, targetTrack)
    .filter((clip) => Number(clip.props.start) >= insertStart - EPSILON)
    .map((clip) => ({ type: "node.update", nodeId: clip.id, patch: { props: { start: Number(clip.props.start) + duration } } })) : [];
  return [...shifts, { type: "node.add", node: preview.clip }, ...preview.edges.map((edge) => ({ type: "edge.add", edge }))];
}

export function slipClipOperations(graph, clipId, { delta = 0, inPoint } = {}) {
  const clip = clipFromGraph(graph, clipId);
  const asset = graph.nodes[clip.props.assetId];
  const current = Number(clip.props.inPoint ?? 0);
  const next = inPoint === undefined ? current + number(delta, "Slip delta") : number(inPoint, "Slip inPoint");
  if (next < 0) throw new Error("Slip cannot move before source start");
  const sourceDuration = Number(clip.props.duration) * Number(clip.props.playbackRate ?? 1);
  const assetDuration = Number(asset?.props.duration);
  if (Number.isFinite(assetDuration) && next + sourceDuration > assetDuration + EPSILON) throw new Error("Slip exceeds source duration");
  return [{ type: "node.update", nodeId: clip.id, patch: { props: { inPoint: next } } }];
}

export function setPlaybackRateOperations(graph, clipId, rate, { preserveSourceRange = true } = {}) {
  const clip = clipFromGraph(graph, clipId);
  const nextRate = number(rate, "Playback rate");
  if (nextRate <= 0) throw new Error("Playback rate must be positive");
  const patch = { playbackRate: nextRate };
  if (preserveSourceRange) patch.duration = Number(clip.props.duration) * Number(clip.props.playbackRate ?? 1) / nextRate;
  return [{ type: "node.update", nodeId: clip.id, patch: { props: patch } }];
}

export function findTimelineOverlaps(graph, trackId) {
  const clips = clipsOnTrack(graph, trackId);
  const overlaps = [];
  for (let i = 0; i < clips.length; i += 1) {
    for (let j = i + 1; j < clips.length; j += 1) {
      if (Number(clips[j].props.start) >= clipEnd(clips[i]) - EPSILON) break;
      overlaps.push([clips[i].id, clips[j].id]);
    }
  }
  return overlaps;
}
