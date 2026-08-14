import { assertValidGraph, edgesFrom, edgesTo, nodesByKind } from "./graph.js";

const EPSILON = 0.001;

function finite(value) { return Number.isFinite(Number(value)); }
function positive(value) { return finite(value) && Number(value) > 0; }
function nonNegative(value) { return finite(value) && Number(value) >= 0; }

export function collectInvariantViolations(graph) {
  const violations = [];
  try { assertValidGraph(graph); } catch (error) {
    return [{ code: "graph.invalid", message: error.message }];
  }

  const projectChildren = new Set(edgesFrom(graph, graph.projectId, "contains").map((edge) => edge.to));
  for (const composition of nodesByKind(graph, "composition")) {
    if (!projectChildren.has(composition.id)) violations.push({ code: "composition.orphaned", nodeId: composition.id, message: `Composition ${composition.id} is not contained by the project` });
    if (!positive(composition.props.width) || !positive(composition.props.height)) violations.push({ code: "composition.dimensions", nodeId: composition.id, message: `Composition ${composition.id} must have positive dimensions` });
    if (!positive(composition.props.fps)) violations.push({ code: "composition.fps", nodeId: composition.id, message: `Composition ${composition.id} must have a positive fps` });
    if (!nonNegative(composition.props.duration)) violations.push({ code: "composition.duration", nodeId: composition.id, message: `Composition ${composition.id} must have a non-negative duration` });
  }

  for (const track of nodesByKind(graph, "track")) {
    if (!["visual", "audio"].includes(track.props.mediaKind)) violations.push({ code: "track.media-kind", nodeId: track.id, message: `Track ${track.id} has unsupported mediaKind ${track.props.mediaKind}` });
    const parents = edgesTo(graph, track.id, "contains").map((edge) => graph.nodes[edge.from]).filter((node) => node?.kind === "composition");
    if (parents.length !== 1) violations.push({ code: "track.parent", nodeId: track.id, message: `Track ${track.id} must belong to exactly one composition` });
  }

  for (const clip of nodesByKind(graph, "clip")) {
    const { assetId, trackId } = clip.props;
    const asset = graph.nodes[assetId];
    const track = graph.nodes[trackId];
    if (!asset || asset.kind !== "asset") violations.push({ code: "clip.asset", nodeId: clip.id, message: `Clip ${clip.id} references an invalid asset` });
    if (!track || track.kind !== "track") violations.push({ code: "clip.track", nodeId: clip.id, message: `Clip ${clip.id} references an invalid track` });
    if (!nonNegative(clip.props.start)) violations.push({ code: "clip.start", nodeId: clip.id, message: `Clip ${clip.id} start must be non-negative` });
    if (!positive(clip.props.duration)) violations.push({ code: "clip.duration", nodeId: clip.id, message: `Clip ${clip.id} duration must be positive` });
    if (!nonNegative(clip.props.inPoint ?? 0)) violations.push({ code: "clip.in-point", nodeId: clip.id, message: `Clip ${clip.id} inPoint must be non-negative` });
    if (!positive(clip.props.playbackRate ?? 1)) violations.push({ code: "clip.playback-rate", nodeId: clip.id, message: `Clip ${clip.id} playbackRate must be positive` });
    if (clip.props.gainDb !== undefined && (!finite(clip.props.gainDb) || Number(clip.props.gainDb) < -96 || Number(clip.props.gainDb) > 24)) violations.push({ code: "clip.gain-db", nodeId: clip.id, message: `Clip ${clip.id} gainDb must be between -96 and 24` });
    if (clip.props.pan !== undefined && (!finite(clip.props.pan) || Number(clip.props.pan) < -1 || Number(clip.props.pan) > 1)) violations.push({ code: "clip.pan", nodeId: clip.id, message: `Clip ${clip.id} pan must be between -1 and 1` });
    if (clip.props.fadeIn !== undefined && !nonNegative(clip.props.fadeIn)) violations.push({ code: "clip.fade-in", nodeId: clip.id, message: `Clip ${clip.id} fadeIn must be non-negative` });
    if (clip.props.fadeOut !== undefined && !nonNegative(clip.props.fadeOut)) violations.push({ code: "clip.fade-out", nodeId: clip.id, message: `Clip ${clip.id} fadeOut must be non-negative` });
    const containment = edgesTo(graph, clip.id, "contains").filter((edge) => edge.from === trackId);
    if (containment.length !== 1) violations.push({ code: "clip.containment", nodeId: clip.id, message: `Clip ${clip.id} must be contained by its track` });
    const reference = edgesFrom(graph, clip.id, "references").filter((edge) => edge.to === assetId);
    if (reference.length !== 1) violations.push({ code: "clip.reference", nodeId: clip.id, message: `Clip ${clip.id} must reference its asset` });
    if (asset && track) {
      const audioAsset = ["audio", "music"].includes(asset.props.mediaKind);
      if (track.props.mediaKind !== (audioAsset ? "audio" : "visual")) violations.push({ code: "clip.track-kind", nodeId: clip.id, message: `Clip ${clip.id} is on an incompatible track` });
      const assetDuration = Number(asset.props.duration);
      if (Number.isFinite(assetDuration) && assetDuration > 0 && asset.props.mediaKind !== "image") {
        const sourceEnd = Number(clip.props.inPoint ?? 0) + Number(clip.props.duration ?? 0) * Number(clip.props.playbackRate ?? 1);
        if (sourceEnd > assetDuration + EPSILON) violations.push({ code: "clip.source-range", nodeId: clip.id, message: `Clip ${clip.id} extends beyond source media` });
      }
    }
  }

  for (const layer of nodesByKind(graph, "layer")) {
    if (layer.props.role === "marker") continue;
    const parents = edgesTo(graph, layer.id, "contains").map((edge) => graph.nodes[edge.from]).filter((node) => node?.kind === "composition");
    if (parents.length !== 1) violations.push({ code: "layer.parent", nodeId: layer.id, message: `Layer ${layer.id} must belong to exactly one composition` });
    if (layer.props.role === "text") {
      if (typeof layer.props.text !== "string") violations.push({ code: "layer.text", nodeId: layer.id, message: `Text layer ${layer.id} requires string text` });
      if (!positive(layer.props.fontSize)) violations.push({ code: "layer.font-size", nodeId: layer.id, message: `Text layer ${layer.id} requires a positive fontSize` });
      continue;
    }
    if (layer.props.role === "shape") {
      if (!["rectangle", "ellipse"].includes(layer.props.shapeType)) violations.push({ code: "layer.shape-type", nodeId: layer.id, message: `Shape layer ${layer.id} has an unsupported shape type` });
      if (!positive(layer.props.width) || !positive(layer.props.height)) violations.push({ code: "layer.shape-dimensions", nodeId: layer.id, message: `Shape layer ${layer.id} requires positive dimensions` });
      continue;
    }
    const asset = graph.nodes[layer.props.assetId];
    if (!asset || asset.kind !== "asset") violations.push({ code: "layer.asset", nodeId: layer.id, message: `Layer ${layer.id} references an invalid asset` });
    if (asset && !edgesFrom(graph, layer.id, "references").some((edge) => edge.to === asset.id)) violations.push({ code: "layer.reference", nodeId: layer.id, message: `Layer ${layer.id} must reference its asset` });
  }

  for (const effect of nodesByKind(graph, "effect")) {
    const targets = edgesFrom(graph, effect.id, "targets");
    if (targets.length !== 1 || !["layer", "clip"].includes(graph.nodes[targets[0]?.to]?.kind)) violations.push({ code: "effect.target", nodeId: effect.id, message: `Effect ${effect.id} must target exactly one layer or clip` });
    if (typeof effect.props.effectType !== "string" || !effect.props.effectType) violations.push({ code: "effect.type", nodeId: effect.id, message: `Effect ${effect.id} requires an effectType` });
  }

  for (const output of nodesByKind(graph, "output")) {
    const composition = graph.nodes[output.props.compositionId];
    if (!composition || composition.kind !== "composition") violations.push({ code: "output.composition", nodeId: output.id, message: `Output ${output.id} references an invalid composition` });
    if (!positive(output.props.width) || !positive(output.props.height)) violations.push({ code: "output.dimensions", nodeId: output.id, message: `Output ${output.id} must have positive dimensions` });
    if (!positive(output.props.fps)) violations.push({ code: "output.fps", nodeId: output.id, message: `Output ${output.id} must have a positive fps` });
    if (!nonNegative(output.props.rangeStart) || !nonNegative(output.props.rangeEnd) || Number(output.props.rangeEnd) < Number(output.props.rangeStart)) violations.push({ code: "output.range", nodeId: output.id, message: `Output ${output.id} has an invalid render range` });
    const targets = edgesFrom(graph, output.id, "targets").filter((edge) => edge.to === output.props.compositionId);
    if (targets.length !== 1) violations.push({ code: "output.target", nodeId: output.id, message: `Output ${output.id} must target its composition exactly once` });
    if (!projectChildren.has(output.id)) violations.push({ code: "output.parent", nodeId: output.id, message: `Output ${output.id} must be contained by the project` });
  }

  for (const node of [...nodesByKind(graph, "layer"), ...nodesByKind(graph, "clip")]) {
    for (const [property, frames] of Object.entries(node.props.keyframes ?? {})) {
      if (!Array.isArray(frames)) { violations.push({ code: "keyframes.shape", nodeId: node.id, message: `Keyframes for ${node.id}.${property} must be an array` }); continue; }
      let previous = -Infinity;
      for (const frame of frames) {
        const time = Number(frame?.time); const value = Number(frame?.value);
        if (!Number.isFinite(time) || time < 0 || !Number.isFinite(value) || time < previous) violations.push({ code: "keyframes.value", nodeId: node.id, message: `Keyframes for ${node.id}.${property} must contain sorted finite time/value pairs` });
        previous = time;
      }
    }
  }
  return violations;
}

export function assertProjectInvariants(graph) {
  const violations = collectInvariantViolations(graph);
  if (violations.length) {
    const error = new Error(`Project invariant failed: ${violations[0].message}`);
    error.violations = violations;
    throw error;
  }
  return graph;
}
