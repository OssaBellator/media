import { transformForNode } from "./transforms.js";

export const KEYFRAME_EASINGS = Object.freeze(["linear", "hold", "ease-in", "ease-out", "ease-in-out"]);
const EASINGS = new Set(KEYFRAME_EASINGS);

function finite(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a finite number`);
  return parsed;
}
function ease(progress, easing) {
  const t = Math.min(1, Math.max(0, progress));
  if (easing === "hold") return 0;
  if (easing === "ease-in") return t * t;
  if (easing === "ease-out") return 1 - (1 - t) * (1 - t);
  if (easing === "ease-in-out") return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
  return t;
}

export function keyframesFor(node, property) {
  const frames = node?.props?.keyframes?.[property];
  return Array.isArray(frames) ? [...frames].sort((a, b) => Number(a.time) - Number(b.time)) : [];
}

export function setKeyframeOperations(graph, nodeId, property, { time, value, easing = "linear" }) {
  const node = graph.nodes[nodeId];
  if (!node || !["layer", "clip"].includes(node.kind)) throw new Error(`Node ${nodeId} cannot be animated`);
  if (typeof property !== "string" || !property) throw new Error("Keyframe property must be non-empty");
  if (!EASINGS.has(easing)) throw new Error(`Unsupported keyframe easing: ${easing}`);
  const frame = { time: Math.max(0, finite(time, "Keyframe time")), value: finite(value, "Keyframe value"), easing };
  const frames = keyframesFor(node, property).filter((existing) => Math.abs(Number(existing.time) - frame.time) > 0.0001);
  frames.push(frame); frames.sort((a, b) => a.time - b.time);
  return [{ type: "node.update", nodeId, patch: { props: { keyframes: { ...(node.props.keyframes ?? {}), [property]: frames } } } }];
}

export function removeKeyframeOperations(graph, nodeId, property, time, tolerance = 0.0001) {
  const node = graph.nodes[nodeId];
  if (!node || !["layer", "clip"].includes(node.kind)) throw new Error(`Node ${nodeId} cannot be animated`);
  const target = finite(time, "Keyframe time");
  const frames = keyframesFor(node, property).filter((frame) => Math.abs(Number(frame.time) - target) > tolerance);
  const keyframes = { ...(node.props.keyframes ?? {}) };
  if (frames.length) keyframes[property] = frames; else delete keyframes[property];
  return [{ type: "node.update", nodeId, patch: { props: { keyframes } } }];
}

export function evaluateKeyframes(node, property, time, fallback = 0) {
  const frames = keyframesFor(node, property);
  if (!frames.length) return Number(fallback);
  const target = Number(time);
  if (target <= frames[0].time) return Number(frames[0].value);
  if (target >= frames.at(-1).time) return Number(frames.at(-1).value);
  const rightIndex = frames.findIndex((frame) => Number(frame.time) >= target);
  const left = frames[rightIndex - 1];
  const right = frames[rightIndex];
  const span = Number(right.time) - Number(left.time);
  if (span <= 0) return Number(right.value);
  const progress = ease((target - Number(left.time)) / span, left.easing ?? "linear");
  return Number(left.value) + (Number(right.value) - Number(left.value)) * progress;
}

export function evaluateAnimatedTransform(node, time) {
  const base = transformForNode(node);
  const animated = { ...base };
  for (const property of ["x", "y", "scaleX", "scaleY", "rotation", "opacity", "anchorX", "anchorY", "cropTop", "cropRight", "cropBottom", "cropLeft"]) {
    if (keyframesFor(node, property).length) animated[property] = evaluateKeyframes(node, property, time, base[property]);
  }
  animated.opacity = Math.min(1, Math.max(0, animated.opacity));
  return animated;
}

export function keyframeSummary(node) {
  const entries = Object.entries(node?.props?.keyframes ?? {});
  return entries.map(([property, frames]) => ({ property, count: Array.isArray(frames) ? frames.length : 0 })).filter((entry) => entry.count > 0);
}
