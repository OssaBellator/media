import { createEdge, createNode, nodesByKind } from "./graph.js";
import { primaryComposition } from "./project.js";
import { DEFAULT_TRANSFORM } from "./transforms.js";

export const TEXT_ALIGNMENTS = Object.freeze(["left", "center", "right"]);

export function createTextLayerOperations(graph, {
  compositionId,
  text = "Title",
  name,
  fontFamily = "Inter, sans-serif",
  fontSize = 96,
  fontWeight = 700,
  color = "#ffffff",
  align = "center",
  lineHeight = 1.1,
  letterSpacing = 0,
  transform = {},
  order,
} = {}) {
  const composition = compositionId ? graph.nodes[compositionId] : primaryComposition(graph);
  if (!composition || composition.kind !== "composition") throw new Error("No composition found for text layer");
  if (!TEXT_ALIGNMENTS.includes(align)) throw new Error(`Unsupported text alignment: ${align}`);
  const size = Number(fontSize);
  if (!Number.isFinite(size) || size <= 0) throw new Error("Text fontSize must be positive");
  const layers = nodesByKind(graph, "layer").filter((layer) => layer.props.compositionId === composition.id && layer.props.role !== "marker");
  const layer = createNode({
    kind: "layer",
    name: name || String(text || "Text").slice(0, 40) || "Text",
    props: {
      role: "text",
      compositionId: composition.id,
      text: String(text ?? ""),
      fontFamily: String(fontFamily || "sans-serif"),
      fontSize: size,
      fontWeight: Math.max(100, Math.min(900, Math.round(Number(fontWeight) || 400))),
      color: String(color || "#ffffff"),
      align,
      lineHeight: Math.max(0.1, Number(lineHeight) || 1.1),
      letterSpacing: Number(letterSpacing) || 0,
      order: order ?? layers.length,
      enabled: true,
      transform: { ...DEFAULT_TRANSFORM, ...transform },
    },
  });
  return [
    { type: "node.add", node: layer },
    { type: "edge.add", edge: createEdge({ from: composition.id, to: layer.id }) },
  ];
}

export function updateTextLayerOperations(graph, layerId, patch = {}) {
  const layer = graph.nodes[layerId];
  if (!layer || layer.kind !== "layer" || layer.props.role !== "text") throw new Error(`Unknown text layer: ${layerId}`);
  const props = {};
  if (patch.text !== undefined) props.text = String(patch.text);
  if (patch.fontFamily !== undefined) props.fontFamily = String(patch.fontFamily || "sans-serif");
  if (patch.fontSize !== undefined) {
    const size = Number(patch.fontSize);
    if (!Number.isFinite(size) || size <= 0) throw new Error("Text fontSize must be positive");
    props.fontSize = size;
  }
  if (patch.fontWeight !== undefined) props.fontWeight = Math.max(100, Math.min(900, Math.round(Number(patch.fontWeight) || 400)));
  if (patch.color !== undefined) props.color = String(patch.color || "#ffffff");
  if (patch.align !== undefined) {
    if (!TEXT_ALIGNMENTS.includes(patch.align)) throw new Error(`Unsupported text alignment: ${patch.align}`);
    props.align = patch.align;
  }
  if (patch.lineHeight !== undefined) props.lineHeight = Math.max(0.1, Number(patch.lineHeight) || 1.1);
  if (patch.letterSpacing !== undefined) props.letterSpacing = Number(patch.letterSpacing) || 0;
  return [{ type: "node.update", nodeId: layerId, patch: { props } }];
}
