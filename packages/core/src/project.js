import { addEdge, addNode, createEdge, createGraph, createNode, nodesByKind } from "./graph.js";
import { createId } from "./id.js";

export const DEFAULT_COMPOSITION = { width: 1920, height: 1080, fps: 30, duration: 30, background: "#090a0d" };

export function createMediaProject(name = "Untitled project") {
  let graph = createGraph(name);
  const composition = createNode({ id: createId("composition"), kind: "composition", name: "Main composition", props: DEFAULT_COMPOSITION });
  const videoTrack = createNode({ id: createId("track"), kind: "track", name: "Video 1", props: { mediaKind: "visual", order: 0 } });
  const audioTrack = createNode({ id: createId("track"), kind: "track", name: "Audio 1", props: { mediaKind: "audio", order: 1 } });
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

export function createAsset({ name, mimeType = "", size = 0, uri = "", duration, width, height }) {
  const dimensions = {};
  if (width !== undefined) dimensions.width = width;
  if (height !== undefined) dimensions.height = height;
  const timing = duration !== undefined ? { duration } : {};
  return createNode({ id: createId("asset"), kind: "asset", name, props: { mediaKind: mediaKindFromMime(mimeType), mimeType, size, uri, ...dimensions, ...timing } });
}

export function addAsset(graph, asset) {
  let next = addNode(graph, asset);
  next = addEdge(next, createEdge({ from: graph.projectId, to: asset.id }));
  return next;
}

export function primaryComposition(graph) { return nodesByKind(graph, "composition")[0]; }

export function trackForAsset(graph, asset) {
  const tracks = nodesByKind(graph, "track");
  const wantsAudio = asset.props.mediaKind === "audio" || asset.props.mediaKind === "music";
  return tracks.find((track) => track.props.mediaKind === (wantsAudio ? "audio" : "visual"));
}

export function nextClipStart(graph, trackId) {
  return nodesByKind(graph, "clip")
    .filter((clip) => clip.props.trackId === trackId)
    .reduce((end, clip) => Math.max(end, Number(clip.props.start ?? 0) + Number(clip.props.duration ?? 0)), 0);
}

export function createClipForAsset(graph, asset, start) {
  const track = trackForAsset(graph, asset);
  if (!track) throw new Error(`No compatible track for asset ${asset.id}`);
  const duration = Number(asset.props.duration ?? (asset.props.mediaKind === "image" ? 5 : 6));
  const clip = createNode({ id: createId("clip"), kind: "clip", name: asset.name, props: { assetId: asset.id, trackId: track.id, start: start ?? nextClipStart(graph, track.id), duration, inPoint: 0, playbackRate: 1 } });
  return { clip, edges: [createEdge({ from: track.id, to: clip.id }), createEdge({ from: clip.id, to: asset.id, type: "references" })] };
}
