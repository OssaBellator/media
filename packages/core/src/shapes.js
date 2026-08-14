import { createEdge, createNode, nodesByKind } from "./graph.js";
import { primaryComposition } from "./project.js";
import { DEFAULT_TRANSFORM } from "./transforms.js";

export const SHAPE_TYPES = Object.freeze(["rectangle", "ellipse"]);

export function createShapeLayerOperations(graph, {
  compositionId,
  shapeType = "rectangle",
  name,
  width = 500,
  height = 300,
  fill = "#d9ff5a",
  stroke = "#00000000",
  strokeWidth = 0,
  cornerRadius = 32,
  transform = {},
  order,
} = {}) {
  if (!SHAPE_TYPES.includes(shapeType)) throw new Error(`Unsupported shape type: ${shapeType}`);
  const composition = compositionId ? graph.nodes[compositionId] : primaryComposition(graph);
  if (!composition || composition.kind !== "composition") throw new Error("No composition found for shape layer");
  const w = Number(width); const h = Number(height);
  if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) throw new Error("Shape dimensions must be positive");
  const layers = nodesByKind(graph, "layer").filter((layer) => layer.props.compositionId === composition.id && layer.props.role !== "marker");
  const layer = createNode({
    kind: "layer",
    name: name || (shapeType === "ellipse" ? "Ellipse" : "Rectangle"),
    props: {
      role: "shape", compositionId: composition.id, shapeType, width: w, height: h,
      fill: String(fill), stroke: String(stroke), strokeWidth: Math.max(0, Number(strokeWidth) || 0),
      cornerRadius: Math.max(0, Number(cornerRadius) || 0), order: order ?? layers.length,
      enabled: true, transform: { ...DEFAULT_TRANSFORM, ...transform },
    },
  });
  return [{ type: "node.add", node: layer }, { type: "edge.add", edge: createEdge({ from: composition.id, to: layer.id }) }];
}

export function updateShapeLayerOperations(graph, layerId, patch = {}) {
  const layer = graph.nodes[layerId];
  if (!layer || layer.kind !== "layer" || layer.props.role !== "shape") throw new Error(`Unknown shape layer: ${layerId}`);
  const props = {};
  if (patch.shapeType !== undefined) {
    if (!SHAPE_TYPES.includes(patch.shapeType)) throw new Error(`Unsupported shape type: ${patch.shapeType}`);
    props.shapeType = patch.shapeType;
  }
  for (const key of ["width", "height"]) if (patch[key] !== undefined) {
    const value = Number(patch[key]);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`Shape ${key} must be positive`);
    props[key] = value;
  }
  if (patch.fill !== undefined) props.fill = String(patch.fill);
  if (patch.stroke !== undefined) props.stroke = String(patch.stroke);
  if (patch.strokeWidth !== undefined) props.strokeWidth = Math.max(0, Number(patch.strokeWidth) || 0);
  if (patch.cornerRadius !== undefined) props.cornerRadius = Math.max(0, Number(patch.cornerRadius) || 0);
  return [{ type: "node.update", nodeId: layerId, patch: { props } }];
}
