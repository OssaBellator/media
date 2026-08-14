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
    const asset = graph.nodes[layer.props.assetId];
    if (!asset || asset.kind !== "asset") violations.push({ code: "layer.asset", nodeId: layer.id, message: `Layer ${layer.id} references an invalid asset` });
    const parents = edgesTo(graph, layer.id, "contains").map((edge) => graph.nodes[edge.from]).filter((node) => node?.kind === "composition");
    if (parents.length !== 1) violations.push({ code: "layer.parent", nodeId: layer.id, message: `Layer ${layer.id} must belong to exactly one composition` });
    if (asset && !edgesFrom(graph, layer.id, "references").some((edge) => edge.to === asset.id)) violations.push({ code: "layer.reference", nodeId: layer.id, message: `Layer ${layer.id} must reference its asset` });
  }

  for (const effect of nodesByKind(graph, "effect")) {
    const targets = edgesFrom(graph, effect.id, "targets");
    if (targets.length !== 1 || !["layer", "clip"].includes(graph.nodes[targets[0]?.to]?.kind)) violations.push({ code: "effect.target", nodeId: effect.id, message: `Effect ${effect.id} must target exactly one layer or clip` });
    if (typeof effect.props.effectType !== "string" || !effect.props.effectType) violations.push({ code: "effect.type", nodeId: effect.id, message: `Effect ${effect.id} requires an effectType` });
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
