import { createEdge, createNode, nodesByKind } from "./graph.js";
import { primaryComposition } from "./project.js";

export const DEFAULT_TRANSFORM = Object.freeze({
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  opacity: 1,
  anchorX: 0.5,
  anchorY: 0.5,
  cropTop: 0,
  cropRight: 0,
  cropBottom: 0,
  cropLeft: 0,
});

function finite(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeTransform(transform = {}) {
  return {
    x: finite(transform.x, DEFAULT_TRANSFORM.x),
    y: finite(transform.y, DEFAULT_TRANSFORM.y),
    scaleX: finite(transform.scaleX, DEFAULT_TRANSFORM.scaleX),
    scaleY: finite(transform.scaleY, DEFAULT_TRANSFORM.scaleY),
    rotation: finite(transform.rotation, DEFAULT_TRANSFORM.rotation),
    opacity: Math.min(1, Math.max(0, finite(transform.opacity, DEFAULT_TRANSFORM.opacity))),
    anchorX: Math.min(1, Math.max(0, finite(transform.anchorX, DEFAULT_TRANSFORM.anchorX))),
    anchorY: Math.min(1, Math.max(0, finite(transform.anchorY, DEFAULT_TRANSFORM.anchorY))),
    cropTop: Math.min(1, Math.max(0, finite(transform.cropTop, DEFAULT_TRANSFORM.cropTop))),
    cropRight: Math.min(1, Math.max(0, finite(transform.cropRight, DEFAULT_TRANSFORM.cropRight))),
    cropBottom: Math.min(1, Math.max(0, finite(transform.cropBottom, DEFAULT_TRANSFORM.cropBottom))),
    cropLeft: Math.min(1, Math.max(0, finite(transform.cropLeft, DEFAULT_TRANSFORM.cropLeft))),
  };
}

export function transformForNode(node) {
  return normalizeTransform(node?.props?.transform);
}

export function transformNodeOperations(graph, nodeId, patch) {
  const node = graph.nodes[nodeId];
  if (!node || !["layer", "clip"].includes(node.kind)) throw new Error(`Node ${nodeId} cannot be transformed`);
  const current = transformForNode(node);
  const next = normalizeTransform({ ...current, ...patch });
  if (Math.abs(next.scaleX) < 0.001 || Math.abs(next.scaleY) < 0.001) throw new Error("Transform scale cannot be zero");
  if (next.cropLeft + next.cropRight >= 1 || next.cropTop + next.cropBottom >= 1) throw new Error("Crop cannot remove the entire visual area");
  return [{ type: "node.update", nodeId, patch: { props: { transform: next } } }];
}

export function resetTransformOperations(graph, nodeId) {
  return transformNodeOperations(graph, nodeId, DEFAULT_TRANSFORM);
}

export function createLayerForAssetOperations(graph, assetId, { compositionId, name, order } = {}) {
  const asset = graph.nodes[assetId];
  if (!asset || asset.kind !== "asset") throw new Error(`Unknown asset: ${assetId}`);
  if (["audio", "music"].includes(asset.props.mediaKind)) throw new Error("Audio-only assets cannot be added as visual Canvas layers");
  const composition = compositionId ? graph.nodes[compositionId] : primaryComposition(graph);
  if (!composition || composition.kind !== "composition") throw new Error("No target composition found");
  const existingLayers = nodesByKind(graph, "layer").filter((layer) => layer.props.role !== "marker");
  const layer = createNode({
    kind: "layer",
    name: name || asset.name,
    props: {
      assetId: asset.id,
      compositionId: composition.id,
      order: order ?? existingLayers.length,
      enabled: true,
      blendMode: "normal",
      transform: { ...DEFAULT_TRANSFORM },
    },
  });
  return [
    { type: "node.add", node: layer },
    { type: "edge.add", edge: createEdge({ from: composition.id, to: layer.id }) },
    { type: "edge.add", edge: createEdge({ from: layer.id, to: asset.id, type: "references" }) },
  ];
}

export function reorderLayerOperations(graph, layerId, order) {
  const layer = graph.nodes[layerId];
  if (!layer || layer.kind !== "layer" || layer.props.role === "marker") throw new Error(`Unknown visual layer: ${layerId}`);
  const nextOrder = Math.max(0, Math.round(finite(order, 0)));
  return [{ type: "node.update", nodeId: layerId, patch: { props: { order: nextOrder } } }];
}
