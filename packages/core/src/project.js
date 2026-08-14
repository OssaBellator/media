import { addEdge, addNode, createEdge, createGraph, createNode, nodesByKind } from "./graph.js";
import { createId } from "./id.js";

export const DEFAULT_COMPOSITION = { width: 1920, height: 1080, fps: 30, duration: 30, background: "#090a0d" };

export function createMediaProject(name = "Untitled project") {
  let graph = createGraph(name);
  const composition = createNode({ id: createId("composition"), kind: "composition", name: "Main composition", props: DEFAULT_COMPOSITION });
  const videoTrack = createNode({ id: createId("track"), kind: "track", name: "Video 1", props: { mediaKind: "visual", order: 0, muted: false, locked: false } });
  const audioTrack = createNode({ id: createId("track"), kind: "track", name: "Audio 1", props: { mediaKind: "audio", order: 1, muted: false, locked: false } });
  graph = addNode(graph, composition);
  graph = addNode(graph, videoTrack);
  graph = addNode(graph, audioTrack);
  graph = addEdge(graph, createEdge({ from: graph.projectId, to: composition.id }));
  graph = addEdge(graph, createEdge({ from: composition.id, to: videoTrack.id }));
  graph = addEdge(graph, createEdge({ from: composition.id, to: audioTrack.id }));
  return graph;
}

export function mediaKindFromMime(mimeType = "") {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.includes("svg")) return "vector";
  return "unknown";
}

export function createAsset({ name, mimeType = "", size = 0, uri = "", duration, width, height, hash, waveform }) {
  const props = { mediaKind: mediaKindFromMime(mimeType), mimeType, size, uri };
  if (width !== undefined) props.width = width;
  if (height !== undefined) props.height = height;
  if (duration !== undefined) props.duration = duration;
  if (hash !== undefined) props.hash = hash;
  if (waveform !== undefined) props.waveform = waveform;
  return createNode({ id: createId("asset"), kind: "asset", name, props });
}

export function addAsset(graph, asset) {
  let next = addNode(graph, asset);
  next = addEdge(next, createEdge({ from: graph.projectId, to: asset.id }));
  return next;
}

export function primaryComposition(graph) { return nodesByKind(graph, "composition")[0]; }

export function trackForAsset(graph, asset) {
  const tracks = nodesByKind(graph, "track").sort((a, b) => Number(a.props.order ?? 0) - Number(b.props.order ?? 0));
  const wantsAudio = asset.props.mediaKind === "audio" || asset.props.mediaKind === "music";
  return tracks.find((track) => track.props.mediaKind === (wantsAudio ? "audio" : "visual"));
}

export function nextClipStart(graph, trackId) {
  return nodesByKind(graph, "clip")
    .filter((clip) => clip.props.trackId === trackId)
    .reduce((end, clip) => Math.max(end, Number(clip.props.start ?? 0) + Number(clip.props.duration ?? 0)), 0);
}

export function createClipForAsset(graph, asset, start, trackId) {
  const track = trackId ? graph.nodes[trackId] : trackForAsset(graph, asset);
  if (!track || track.kind !== "track") throw new Error(`No compatible track for asset ${asset.id}`);
  const wantsAudio = ["audio", "music"].includes(asset.props.mediaKind);
  if (track.props.mediaKind !== (wantsAudio ? "audio" : "visual")) throw new Error(`Track ${track.id} is incompatible with asset ${asset.id}`);
  const duration = Number(asset.props.duration ?? (asset.props.mediaKind === "image" ? 5 : 6));
  const clip = createNode({
    id: createId("clip"),
    kind: "clip",
    name: asset.name,
    props: { assetId: asset.id, trackId: track.id, start: start ?? nextClipStart(graph, track.id), duration, inPoint: 0, playbackRate: 1, enabled: true },
  });
  return { clip, edges: [createEdge({ from: track.id, to: clip.id }), createEdge({ from: clip.id, to: asset.id, type: "references" })] };
}

export function createTrackOperations(graph, { compositionId, mediaKind = "visual", name, order } = {}) {
  if (!["visual", "audio"].includes(mediaKind)) throw new Error(`Unsupported track mediaKind: ${mediaKind}`);
  const composition = compositionId ? graph.nodes[compositionId] : primaryComposition(graph);
  if (!composition || composition.kind !== "composition") throw new Error("No target composition found");
  const tracks = nodesByKind(graph, "track");
  const track = createNode({
    id: createId("track"), kind: "track",
    name: name || `${mediaKind === "audio" ? "Audio" : "Video"} ${tracks.filter((item) => item.props.mediaKind === mediaKind).length + 1}`,
    props: { mediaKind, order: order ?? tracks.length, muted: false, locked: false },
  });
  return [{ type: "node.add", node: track }, { type: "edge.add", edge: createEdge({ from: composition.id, to: track.id }) }];
}

export function setTrackStateOperations(graph, trackId, patch = {}) {
  const track = graph.nodes[trackId];
  if (!track || track.kind !== "track") throw new Error(`Unknown track: ${trackId}`);
  const props = {};
  if (patch.muted !== undefined) props.muted = Boolean(patch.muted);
  if (patch.locked !== undefined) props.locked = Boolean(patch.locked);
  if (patch.order !== undefined) props.order = Math.max(0, Math.round(Number(patch.order) || 0));
  return [{ type: "node.update", nodeId: trackId, patch: { props } }];
}
