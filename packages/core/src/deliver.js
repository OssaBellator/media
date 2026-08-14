import { createEdge, createNode, nodesByKind } from "./graph.js";
import { primaryComposition } from "./project.js";
import { timelineDuration } from "./timeline.js";
import { createAudioMixPlan } from "./audio.js";

export const OUTPUT_FORMATS = Object.freeze(["mp4", "webm", "wav", "png-sequence", "jpeg-sequence", "render-plan"]);
const OUTPUT_FORMAT_SET = new Set(OUTPUT_FORMATS);

export const DELIVERY_PRESETS = Object.freeze({
  "source-master": { label: "Source master", format: "mp4", codec: "h264", width: null, height: null, fps: null, audioCodec: "aac" },
  "vertical-social": { label: "Vertical social", format: "mp4", codec: "h264", width: 1080, height: 1920, fps: 30, audioCodec: "aac" },
  "square-social": { label: "Square social", format: "mp4", codec: "h264", width: 1080, height: 1080, fps: 30, audioCodec: "aac" },
  "web-preview": { label: "Web preview", format: "webm", codec: "vp9", width: 1280, height: 720, fps: 30, audioCodec: "opus" },
  "png-sequence": { label: "PNG sequence", format: "png-sequence", codec: "png", width: null, height: null, fps: null, audioCodec: null },
  "render-plan": { label: "Render plan", format: "render-plan", codec: "json", width: null, height: null, fps: null, audioCodec: null },
});

function finitePositive(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} must be positive`);
  return parsed;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

export function stableStringify(value) { return JSON.stringify(stable(value)); }

export function deterministicHash(value) {
  const input = stableStringify(value);
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, "0");
}

export function createOutputOperations(graph, { compositionId, preset = "source-master", name, ...overrides } = {}) {
  const composition = compositionId ? graph.nodes[compositionId] : primaryComposition(graph);
  if (!composition || composition.kind !== "composition") throw new Error("No composition found for output");
  const presetSettings = DELIVERY_PRESETS[preset];
  if (!presetSettings) throw new Error(`Unknown delivery preset: ${preset}`);
  const settings = { ...presetSettings, ...overrides };
  if (!OUTPUT_FORMAT_SET.has(settings.format)) throw new Error(`Unsupported output format: ${settings.format}`);
  const duration = Math.max(Number(composition.props.duration ?? 0), timelineDuration(graph, 0));
  const output = createNode({
    kind: "output",
    name: name || settings.label || "Output",
    props: {
      compositionId: composition.id,
      preset,
      format: settings.format,
      codec: settings.codec,
      audioCodec: settings.audioCodec ?? null,
      width: settings.width ?? Number(composition.props.width),
      height: settings.height ?? Number(composition.props.height),
      fps: settings.fps ?? Number(composition.props.fps),
      rangeStart: Math.max(0, Number(settings.rangeStart ?? 0)),
      rangeEnd: Math.max(0, Number(settings.rangeEnd ?? duration)),
      includeAudio: settings.includeAudio !== false,
    },
  });
  if (output.props.rangeEnd < output.props.rangeStart) throw new Error("Output rangeEnd must be after rangeStart");
  return [
    { type: "node.add", node: output },
    { type: "edge.add", edge: createEdge({ from: graph.projectId, to: output.id }) },
    { type: "edge.add", edge: createEdge({ from: output.id, to: composition.id, type: "targets" }) },
  ];
}

export function updateOutputOperations(graph, outputId, patch = {}) {
  const output = graph.nodes[outputId];
  if (!output || output.kind !== "output") throw new Error(`Unknown output: ${outputId}`);
  const props = { ...output.props };
  for (const key of ["format", "codec", "audioCodec", "preset"]) if (patch[key] !== undefined) props[key] = patch[key];
  for (const key of ["width", "height", "fps"]) if (patch[key] !== undefined) props[key] = finitePositive(patch[key], key);
  for (const key of ["rangeStart", "rangeEnd"]) if (patch[key] !== undefined) props[key] = Math.max(0, Number(patch[key]) || 0);
  if (patch.includeAudio !== undefined) props.includeAudio = Boolean(patch.includeAudio);
  if (!OUTPUT_FORMAT_SET.has(props.format)) throw new Error(`Unsupported output format: ${props.format}`);
  if (props.rangeEnd < props.rangeStart) throw new Error("Output rangeEnd must be after rangeStart");
  const operation = { type: "node.update", nodeId: outputId, patch: { props } };
  if (patch.name !== undefined) operation.patch.name = String(patch.name || "Output");
  return [operation];
}

export function outputForId(graph, outputId) {
  const output = graph.nodes[outputId];
  if (!output || output.kind !== "output") throw new Error(`Unknown output: ${outputId}`);
  return output;
}

export function renderFrameTimes(output) {
  const start = Number(output.props.rangeStart ?? 0);
  const end = Number(output.props.rangeEnd ?? start);
  const fps = finitePositive(output.props.fps, "Output fps");
  if (end <= start) return [];
  const startFrame = Math.ceil(start * fps - 1e-9);
  const endFrameExclusive = Math.ceil(end * fps - 1e-9);
  return Array.from({ length: Math.max(0, endFrameExclusive - startFrame) }, (_, index) => (startFrame + index) / fps);
}

export function collectRenderDependencies(graph, outputId) {
  const output = outputForId(graph, outputId);
  const compositionId = output.props.compositionId;
  const composition = graph.nodes[compositionId];
  const trackIds = new Set(Object.values(graph.edges).filter((edge) => edge.type === "contains" && edge.from === compositionId).map((edge) => edge.to));
  const assetIds = new Set();
  for (const node of Object.values(graph.nodes)) {
    if (node.kind === "layer" && node.props.role !== "marker") {
      const parented = Object.values(graph.edges).some((edge) => edge.type === "contains" && edge.from === compositionId && edge.to === node.id);
      if (parented && node.props.assetId) assetIds.add(node.props.assetId);
    }
    if (node.kind === "clip" && trackIds.has(node.props.trackId) && node.props.assetId) {
      if (Number(node.props.start ?? 0) < Number(output.props.rangeEnd) && Number(node.props.start ?? 0) + Number(node.props.duration ?? 0) > Number(output.props.rangeStart)) assetIds.add(node.props.assetId);
    }
  }
  return [...assetIds].map((assetId) => {
    const asset = graph.nodes[assetId];
    return { assetId, name: asset?.name ?? assetId, hash: asset?.props?.hash ?? null, size: Number(asset?.props?.size ?? 0), mimeType: asset?.props?.mimeType ?? "" };
  }).sort((a, b) => a.assetId.localeCompare(b.assetId));
}

export function canonicalRenderState(graph, outputId) {
  const output = outputForId(graph, outputId);
  const compositionId = output.props.compositionId;
  const contained = new Set([compositionId]);
  for (const edge of Object.values(graph.edges)) if (edge.type === "contains" && edge.from === compositionId) contained.add(edge.to);
  for (const clip of nodesByKind(graph, "clip")) if (contained.has(clip.props.trackId)) contained.add(clip.id);
  let changed = true;
  while (changed) {
    changed = false;
    for (const effect of nodesByKind(graph, "effect")) {
      const target = Object.values(graph.edges).find((edge) => edge.type === "targets" && edge.from === effect.id)?.to;
      if (target && contained.has(target) && !contained.has(effect.id)) { contained.add(effect.id); changed = true; }
    }
  }
  const nodes = [...contained].map((id) => graph.nodes[id]).filter(Boolean).map((node) => ({
    id: node.id, kind: node.kind, name: node.name, props: structuredClone(node.props ?? {}),
  }));
  return nodes.sort((a, b) => a.id.localeCompare(b.id));
}

export function createRenderManifest(graph, outputId) {
  const output = outputForId(graph, outputId);
  const frames = renderFrameTimes(output);
  const dependencies = collectRenderDependencies(graph, outputId);
  const settings = {
    outputId: output.id,
    compositionId: output.props.compositionId,
    name: output.name,
    format: output.props.format,
    codec: output.props.codec,
    audioCodec: output.props.audioCodec,
    width: Number(output.props.width),
    height: Number(output.props.height),
    fps: Number(output.props.fps),
    rangeStart: Number(output.props.rangeStart),
    rangeEnd: Number(output.props.rangeEnd),
    includeAudio: output.props.includeAudio !== false,
  };
  const renderState = canonicalRenderState(graph, outputId);
  const audio = settings.includeAudio ? createAudioMixPlan(graph, { start: settings.rangeStart, end: settings.rangeEnd, sampleRate: 48000, blockSize: 128 }) : null;
  return {
    version: 1,
    settings,
    frameCount: frames.length,
    firstFrameTime: frames[0] ?? null,
    lastFrameTime: frames.at(-1) ?? null,
    audio: audio ? { sampleRate: audio.sampleRate, sampleCount: audio.sampleCount, blockSize: audio.blockSize, blockCount: audio.blockCount, sourceCount: audio.sources.length } : null,
    dependencies,
    signature: deterministicHash({ settings, dependencies, renderState, graphVersion: graph.version }),
  };
}

export function outputsForProject(graph) { return nodesByKind(graph, "output"); }
