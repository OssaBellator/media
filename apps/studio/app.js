import {
  PlannerRegistry,
  addAsset,
  applyOperations,
  assertProjectInvariants,
  buildSourceManifest,
  bladeAllAtTimeOperations,
  commit,
  createAsset,
  createHistory,
  createLayerForAssetOperations,
  createLocalPlannerProvider,
  createMediaProject,
  createOutputOperations,
  createRenderManifest,
  createShapeLayerOperations,
  createTrackOperations,
  createTextLayerOperations,
  duplicateClipOperations,
  createTransport,
  createEffectOperations,
  effectsForTarget,
  evaluateAnimatedTransform,
  evaluateComposition,
  insertAssetOperations,
  keyframeSummary,
  mediaKindFromMime,
  moveClipOperations,
  nodesByKind,
  parseProjectFile,
  pauseTransport,
  planWithProvider,
  playTransport,
  redo,
  resetTransformOperations,
  rippleDeleteClipOperations,
  rippleTrimEndOperations,
  seekTransport,
  serializeProject,
  setKeyframeOperations,
  setClipAudioOperations,
  setPlaybackRateOperations,
  setTrackStateOperations,
  slipClipOperations,
  sourceTimeForClip,
  splitClipOperations,
  stepTransport,
  tickTransport,
  timelineDuration,
  transformForNode,
  transformNodeOperations,
  updateEffectOperations,
  updateShapeLayerOperations,
  updateTextLayerOperations,
  trimClipOperations,
  undo,
} from "/packages/core/src/index.js";
import { mediaCapabilities, probeMedia } from "./media-engine.js";
import { createCompositor } from "./gpu-compositor.js";
import { createStudioView, formatTime } from "./view.js";
import { BrowserFrameProvider, canvasToBlob, renderPlanToCanvas2D } from "./render-engine.js";
import { BrowserAudioMixer } from "./audio-engine.js";
import { findStoredAssetByHash, loadAssetBlob, loadStoredGraph, localAssetUri, saveAssetBlob, saveStoredGraph } from "./storage.js";

const APP_VERSION = "0.4.0";
const app = document.querySelector("#app");
const plannerRegistry = new PlannerRegistry().register(createLocalPlannerProvider());
const capabilities = mediaCapabilities();
const assetUrls = new Map();
const frameProvider = new BrowserFrameProvider({ blobResolver: resolveAssetBlob, maxCacheBytes: 256 * 1024 * 1024, concurrency: 2 });
const audioMixer = new BrowserAudioMixer({ blobResolver: resolveAssetBlob });
let history = createHistory(createMediaProject("Untitled project"));
let workspace = "canvas";
let selectedId = history.present.projectId;
let persistenceStatus = "Local workspace ready";
let compositorBackend = capabilities.webGpu ? "WebGPU probing" : "Canvas2D";
let transport = createTransport({ duration: 30, fps: 30 });
let transportFrame = null;
let transportLastTick = 0;
let activity = [{ title: "Project created", detail: "Universal Creative Graph ready for image, video and audio assets.", operations: [] }];

const graph = () => history.present;
const selectedNode = () => graph().nodes[selectedId] ?? graph().nodes[graph().projectId];
const composition = () => nodesByKind(graph(), "composition")[0];
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const mediaGlyph = (kind) => ({ image: "◫", video: "▶", audio: "≋", music: "♪", vector: "◇", unknown: "·" }[kind] ?? "·");

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
function currentTimelineDuration() { return Math.max(Number(composition()?.props.duration ?? 30), Math.ceil(timelineDuration(graph(), 0)), 1); }
function syncTransport() {
  const comp = composition();
  transport = createTransport({ ...transport, duration: currentTimelineDuration(), fps: Number(comp?.props.fps ?? 30) });
}

function previewUri(asset) {
  if (!asset || asset.kind !== "asset") return "";
  if (assetUrls.has(asset.id)) return assetUrls.get(asset.id);
  const uri = String(asset.props.uri ?? "");
  if (uri.startsWith("media://asset/")) return "";
  return uri;
}
function assetForNode(node) {
  if (!node) return null;
  if (node.kind === "asset") return node;
  if (["clip", "layer"].includes(node.kind)) return graph().nodes[node.props.assetId] ?? null;
  return null;
}
function activePreviewAsset() {
  const direct = assetForNode(selectedNode());
  if (direct) return direct;
  try {
    const plan = evaluateComposition(graph(), { time: transport.time });
    const active = [...plan.visual].reverse().find((item) => item.kind === "clip");
    return active ? graph().nodes[active.assetId] : null;
  } catch { return null; }
}

const studioView = createStudioView({
  graph, selectedNode, composition, previewUri, currentTimelineDuration,
  getTransport: () => transport, capabilities, getCompositorBackend: () => compositorBackend,
});

function cssFilterForNode(node) {
  const filters = [];
  for (const effect of effectsForTarget(graph(), node?.id).filter((item) => item.props.enabled !== false)) {
    const params = effect.props.params ?? {};
    if (effect.props.effectType === "brightness") filters.push(`brightness(${Number(params.amount ?? 1)})`);
    if (effect.props.effectType === "contrast") filters.push(`contrast(${Number(params.amount ?? 1)})`);
    if (effect.props.effectType === "saturation") filters.push(`saturate(${Number(params.amount ?? 1)})`);
    if (effect.props.effectType === "blur") filters.push(`blur(${Math.max(0, Number(params.radius ?? 4))}px)`);
    if (effect.props.effectType === "hue") filters.push(`hue-rotate(${Number(params.degrees ?? 0)}deg)`);
  }
  return filters.join(" ") || "none";
}

function render() {
  syncTransport();
  app.innerHTML = studioView.render({ workspace, persistenceStatus, history, activity, appVersion: APP_VERSION });
  bindEvents();
  initCompositorSurface();
  updateTransportDom();
}

function colorComponents(hex) {
  const value = String(hex ?? "#000000").replace("#", "");
  const normalized = value.length === 3 ? value.split("").map((char) => char + char).join("") : value.padEnd(6, "0").slice(0, 6);
  const number = Number.parseInt(normalized, 16);
  if (!Number.isFinite(number)) return [0, 0, 0, 1];
  return [((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255, 1];
}
async function initCompositorSurface() {
  const surface = document.querySelector("[data-compositor-surface]");
  if (!surface) return;
  try {
    const compositor = await createCompositor(surface);
    compositorBackend = compositor.backend === "webgpu" ? "WebGPU compositor" : "Canvas2D compositor";
    compositor.clear(colorComponents(composition()?.props.background));
    const badge = document.querySelector(".backend-badge");
    if (badge) badge.textContent = compositorBackend;
  } catch { compositorBackend = "Canvas surface"; }
}

function bindEvents() {
  document.querySelectorAll("[data-workspace]").forEach((button) => button.addEventListener("click", () => { workspace = button.dataset.workspace; if (!["cut", "motion"].includes(workspace)) stopTransportPlayback(); render(); }));
  document.querySelectorAll("[data-select]").forEach((button) => button.addEventListener("click", (event) => { if (event.defaultPrevented) return; selectedId = button.dataset.select; render(); }));
  document.querySelectorAll("[data-timeline-action]").forEach((button) => button.addEventListener("click", () => executeTimelineAction(button.dataset.timelineAction)));
  document.querySelectorAll("[data-add-track]").forEach((button) => button.addEventListener("click", () => addTrack(button.dataset.addTrack)));
  document.querySelectorAll("[data-track-action]").forEach((button) => button.addEventListener("click", (event) => { event.stopPropagation(); executeTrackAction(button.dataset.trackId, button.dataset.trackAction); }));
  document.querySelectorAll("[data-canvas-action]").forEach((button) => button.addEventListener("click", () => executeCanvasAction(button.dataset.canvasAction)));
  document.querySelectorAll("[data-keyframe-prop]").forEach((button) => button.addEventListener("click", () => setSelectedKeyframe(button.dataset.keyframeProp)));
  document.querySelectorAll("[data-motion-nudge]").forEach((button) => button.addEventListener("click", () => nudgeMotionProperty(button.dataset.motionNudge, Number(button.dataset.delta))));
  document.querySelectorAll("[data-add-effect]").forEach((button) => button.addEventListener("click", () => addSelectedEffect(button.dataset.addEffect)));
  document.querySelectorAll("[data-toggle-effect]").forEach((button) => button.addEventListener("click", () => toggleSelectedEffect(button.dataset.toggleEffect)));
  document.querySelector("#text-layer-input")?.addEventListener("change", (event) => updateSelectedText({ text: event.target.value }));
  document.querySelectorAll("[data-text-style]").forEach((button) => button.addEventListener("click", () => executeTextStyle(button.dataset.textStyle)));
  document.querySelectorAll("[data-shape-style]").forEach((button) => button.addEventListener("click", () => executeShapeStyle(button.dataset.shapeStyle)));
  document.querySelectorAll("[data-shape-fill]").forEach((button) => button.addEventListener("click", () => executeShapeStyle(null, button.dataset.shapeFill)));
  document.querySelectorAll("[data-transport]").forEach((button) => button.addEventListener("click", () => executeTransportAction(button.dataset.transport)));
  document.querySelectorAll("[data-rate]").forEach((button) => button.addEventListener("click", () => setSelectedRate(Number(button.dataset.rate))));
  document.querySelectorAll("[data-audio-action]").forEach((button) => button.addEventListener("click", () => executeAudioAction(button.dataset.audioAction)));
  document.querySelectorAll("[data-create-output]").forEach((button) => button.addEventListener("click", () => createDeliveryOutput(button.dataset.createOutput)));
  document.querySelectorAll("[data-render-action]").forEach((button) => button.addEventListener("click", (event) => { event.stopPropagation(); executeRenderAction(button.dataset.renderAction, button.dataset.outputId); }));
  document.querySelector("[data-insert-selected]")?.addEventListener("click", insertSelectedAtPlayhead);
  document.querySelector("#file-input")?.addEventListener("change", importFiles);
  document.querySelector("#project-input")?.addEventListener("change", importProjectFile);
  document.querySelector("#relink-input")?.addEventListener("change", relinkSelectedAsset);
  document.querySelector("#export")?.addEventListener("click", exportProject);
  document.querySelector("#undo")?.addEventListener("click", () => { history = undo(history); selectedId = graph().nodes[selectedId] ? selectedId : graph().projectId; persistGraph(); render(); });
  document.querySelector("#redo")?.addEventListener("click", () => { history = redo(history); persistGraph(); render(); });
  document.querySelector("#agent-form")?.addEventListener("submit", (event) => { event.preventDefault(); executeIntent(document.querySelector("#agent-input").value); });
  document.querySelectorAll("[data-command]").forEach((button) => button.addEventListener("click", () => executeIntent(button.dataset.command)));
  bindTimelineSeek();
  bindTimelineDragging();
  bindCanvasDragging();
}

function applyEdit(label, operations, { selectId } = {}) {
  try {
    const next = applyOperations(graph(), operations);
    history = commit(history, next, label);
    if (selectId && next.nodes[selectId]) selectedId = selectId;
    else if (!next.nodes[selectedId]) selectedId = next.projectId;
    syncTransport();
    activity.unshift({ title: label, detail: `${operations.length} validated operation${operations.length === 1 ? "" : "s"} committed atomically.`, operations: operations.map((operation) => operation.type) });
    persistGraph();
  } catch (error) {
    activity.unshift({ title: `${label} failed`, detail: error.message, operations: [] });
  }
  render();
}

function executeCanvasAction(action) {
  const node = selectedNode();
  if (action === "add-text") {
    const operations = createTextLayerOperations(graph(), { text: "Title", transform: { x: 0, y: 0 } });
    const layer = operations.find((operation) => operation.type === "node.add")?.node;
    return applyEdit("Add text layer", operations, { selectId: layer?.id });
  }
  if (action === "add-shape") {
    const operations = createShapeLayerOperations(graph(), { shapeType: "rectangle", transform: { x: 0, y: 0 } });
    const layer = operations.find((operation) => operation.type === "node.add")?.node;
    return applyEdit("Add shape layer", operations, { selectId: layer?.id });
  }
  if (action === "add-layer") {
    const asset = node.kind === "asset" ? node : assetForNode(node);
    if (!asset) return;
    const operations = createLayerForAssetOperations(graph(), asset.id);
    const layer = operations.find((operation) => operation.type === "node.add")?.node;
    return applyEdit(`Add ${asset.name} to Canvas`, operations, { selectId: layer?.id });
  }
  if (node.kind !== "layer" || node.props.role === "marker") return;
  if (action === "delete") return applyEdit("Remove Canvas layer", [{ type: "node.remove", nodeId: node.id }]);
  if (action === "reset") return applyEdit("Reset layer transform", resetTransformOperations(graph(), node.id));
  const transform = transformForNode(node);
  const patch = {};
  if (action === "left") patch.x = transform.x - 50;
  if (action === "right") patch.x = transform.x + 50;
  if (action === "up") patch.y = transform.y - 50;
  if (action === "down") patch.y = transform.y + 50;
  if (action === "rotate-left") patch.rotation = transform.rotation - 15;
  if (action === "rotate-right") patch.rotation = transform.rotation + 15;
  if (action === "scale-down") patch.scaleX = patch.scaleY = Math.max(0.1, transform.scaleX - 0.1);
  if (action === "scale-up") patch.scaleX = patch.scaleY = transform.scaleX + 0.1;
  if (action === "opacity-down") patch.opacity = transform.opacity - 0.1;
  if (action === "opacity-up") patch.opacity = transform.opacity + 0.1;
  if (Object.keys(patch).length) applyEdit("Transform Canvas layer", transformNodeOperations(graph(), node.id, patch));
}

function updateSelectedText(patch) {
  const layer = selectedNode();
  if (layer.kind !== "layer" || layer.props.role !== "text") return;
  applyEdit("Edit text layer", updateTextLayerOperations(graph(), layer.id, patch));
}
function executeTextStyle(action) {
  const layer = selectedNode();
  if (layer.kind !== "layer" || layer.props.role !== "text") return;
  const size = Number(layer.props.fontSize ?? 96);
  const weight = Number(layer.props.fontWeight ?? 700);
  if (action === "size-down") return updateSelectedText({ fontSize: Math.max(8, size - 8) });
  if (action === "size-up") return updateSelectedText({ fontSize: size + 8 });
  if (action === "weight") return updateSelectedText({ fontWeight: weight >= 800 ? 400 : weight + 100 });
}

function executeShapeStyle(action, fill) {
  const layer = selectedNode();
  if (layer.kind !== "layer" || layer.props.role !== "shape") return;
  if (fill) return applyEdit("Change shape fill", updateShapeLayerOperations(graph(), layer.id, { fill }));
  const width = Number(layer.props.width ?? 500);
  const height = Number(layer.props.height ?? 300);
  if (action === "toggle-type") return applyEdit("Change shape type", updateShapeLayerOperations(graph(), layer.id, { shapeType: layer.props.shapeType === "ellipse" ? "rectangle" : "ellipse" }));
  if (action === "size-down") return applyEdit("Resize shape", updateShapeLayerOperations(graph(), layer.id, { width: Math.max(40, width * 0.85), height: Math.max(40, height * 0.85) }));
  if (action === "size-up") return applyEdit("Resize shape", updateShapeLayerOperations(graph(), layer.id, { width: width * 1.15, height: height * 1.15 }));
}

function setSelectedKeyframe(property) {
  const node = selectedNode();
  if (!["layer", "clip"].includes(node.kind)) return;
  const transform = evaluateAnimatedTransform(node, transport.time);
  applyEdit(`Set ${property} keyframe`, setKeyframeOperations(graph(), node.id, property, { time: transport.time, value: transform[property], easing: "ease-in-out" }));
}
function nudgeMotionProperty(property, delta) {
  const node = selectedNode();
  if (!["layer", "clip"].includes(node.kind)) return;
  const current = evaluateAnimatedTransform(node, transport.time)[property];
  const hasFrames = (node.props.keyframes?.[property]?.length ?? 0) > 0;
  const next = property === "opacity" ? Math.min(1, Math.max(0, current + delta)) : property.startsWith("scale") ? Math.max(0.1, current + delta) : current + delta;
  const operations = hasFrames ? setKeyframeOperations(graph(), node.id, property, { time: transport.time, value: next, easing: "ease-in-out" }) : transformNodeOperations(graph(), node.id, { [property]: next });
  applyEdit(`${hasFrames ? "Keyframe" : "Adjust"} ${property}`, operations);
}
function addSelectedEffect(effectType) {
  const node = selectedNode();
  if (!["layer", "clip"].includes(node.kind)) return;
  const defaults = { brightness: { amount: 1.1 }, contrast: { amount: 1.1 }, saturation: { amount: 1.15 }, blur: { radius: 4 }, hue: { degrees: 15 }, gain: { amount: 1 }, pan: { amount: 0 } };
  applyEdit(`Add ${effectType} effect`, createEffectOperations(graph(), node.id, { effectType, params: defaults[effectType] ?? {} }));
}
function toggleSelectedEffect(effectId) {
  const effect = graph().nodes[effectId];
  if (!effect || effect.kind !== "effect") return;
  applyEdit(`${effect.props.enabled === false ? "Enable" : "Disable"} ${effect.name}`, updateEffectOperations(graph(), effect.id, { enabled: effect.props.enabled === false }));
}

function addTrack(mediaKind) {
  applyEdit(`Add ${mediaKind} track`, createTrackOperations(graph(), { mediaKind }));
}
function executeTrackAction(trackId, action) {
  const track = graph().nodes[trackId];
  if (!track || track.kind !== "track") return;
  if (action === "mute") applyEdit(`${track.props.muted ? "Unmute" : "Mute"} ${track.name}`, setTrackStateOperations(graph(), track.id, { muted: !track.props.muted }));
  if (action === "lock") applyEdit(`${track.props.locked ? "Unlock" : "Lock"} ${track.name}`, setTrackStateOperations(graph(), track.id, { locked: !track.props.locked }));
}

function executeTimelineAction(action) {
  const clip = selectedNode();
  if (clip.kind !== "clip") return;
  const start = Number(clip.props.start ?? 0);
  const duration = Number(clip.props.duration ?? 0);
  if (action === "nudge-back") return applyEdit("Move clip back 1s", moveClipOperations(graph(), clip.id, { start: Math.max(0, start - 1), snap: true }));
  if (action === "nudge-forward") return applyEdit("Move clip forward 1s", moveClipOperations(graph(), clip.id, { start: start + 1, snap: true }));
  if (action === "trim-start") return applyEdit("Trim clip start", trimClipOperations(graph(), clip.id, { edge: "start", time: start + Math.min(1, duration / 2), snap: true }));
  if (action === "trim-end") return applyEdit("Trim clip end", trimClipOperations(graph(), clip.id, { edge: "end", time: start + Math.max(duration / 2, duration - 1), snap: true }));
  if (action === "slip-back") return applyEdit("Slip clip source back", slipClipOperations(graph(), clip.id, { delta: -Math.min(1, Number(clip.props.inPoint ?? 0)) }));
  if (action === "slip-forward") return applyEdit("Slip clip source forward", slipClipOperations(graph(), clip.id, { delta: 1 }));
  if (action === "split") {
    const at = transport.time > start && transport.time < start + duration ? transport.time : start + duration / 2;
    return applyEdit("Split clip", splitClipOperations(graph(), clip.id, at));
  }
  if (action === "ripple-delete") return applyEdit("Ripple delete clip", rippleDeleteClipOperations(graph(), clip.id));
  if (action === "duplicate") {
    const operations = duplicateClipOperations(graph(), clip.id, { start: start + duration });
    const duplicate = operations.find((operation) => operation.type === "node.add")?.node;
    return applyEdit("Duplicate clip", operations, { selectId: duplicate?.id });
  }
  if (action === "ripple-trim-end") return applyEdit("Ripple trim clip end", rippleTrimEndOperations(graph(), clip.id, Math.max(start + 0.1, start + duration - Math.min(1, duration / 2))));
  if (action === "blade-all") return applyEdit("Blade all at playhead", bladeAllAtTimeOperations(graph(), transport.time));
}

function setSelectedRate(rate) {
  const clip = selectedNode();
  if (clip.kind !== "clip") return;
  applyEdit(`Set clip speed to ${rate}×`, setPlaybackRateOperations(graph(), clip.id, rate));
}
function insertSelectedAtPlayhead() {
  const asset = selectedNode();
  if (asset.kind !== "asset") return;
  applyEdit(`Insert ${asset.name} at playhead`, insertAssetOperations(graph(), asset.id, { start: transport.time, ripple: true, snap: true }));
}

function executeAudioAction(action) {
  const clip = selectedNode();
  if (clip.kind !== "clip") return;
  const currentGain = Number(clip.props.gainDb ?? 0);
  const currentPan = Number(clip.props.pan ?? 0);
  if (action === "gain-down") return applyEdit("Lower clip gain", setClipAudioOperations(graph(), clip.id, { gainDb: currentGain - 3 }));
  if (action === "gain-up") return applyEdit("Raise clip gain", setClipAudioOperations(graph(), clip.id, { gainDb: currentGain + 3 }));
  if (action === "pan-left") return applyEdit("Pan clip left", setClipAudioOperations(graph(), clip.id, { pan: Math.max(-1, currentPan - 0.25) }));
  if (action === "pan-center") return applyEdit("Center clip pan", setClipAudioOperations(graph(), clip.id, { pan: 0 }));
  if (action === "pan-right") return applyEdit("Pan clip right", setClipAudioOperations(graph(), clip.id, { pan: Math.min(1, currentPan + 0.25) }));
  if (action === "fade") {
    const fade = Math.min(1, Number(clip.props.duration ?? 1) / 4);
    return applyEdit("Set clip fades", setClipAudioOperations(graph(), clip.id, { fadeIn: fade, fadeOut: fade }));
  }
}

function createDeliveryOutput(preset) {
  const operations = createOutputOperations(graph(), { preset });
  const output = operations.find((operation) => operation.type === "node.add")?.node;
  applyEdit(`Create ${output?.name ?? preset} output`, operations, { selectId: output?.id });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function executeRenderAction(action, outputId) {
  const output = graph().nodes[outputId];
  if (!output || output.kind !== "output") return;
  if (action === "select") { selectedId = output.id; render(); return; }
  if (action === "remove") return applyEdit(`Remove ${output.name}`, [{ type: "node.remove", nodeId: output.id }]);
  if (action === "manifest") {
    const manifest = createRenderManifest(graph(), output.id);
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
    downloadBlob(blob, `${safeFilename(output.name)}.render.json`);
    activity.unshift({ title: "Render manifest exported", detail: `${manifest.frameCount} frames · ${manifest.dependencies.length} source dependencies · ${manifest.signature}`, operations: ["evaluate", "manifest"] });
    render();
    return;
  }
  if (action === "still") await renderOutputStill(output);
}

function safeFilename(value) { return String(value || "output").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "output"; }

async function renderOutputStill(output) {
  persistenceStatus = `Rendering ${output.name}…`; render();
  try {
    const time = Math.max(Number(output.props.rangeStart ?? 0), Math.min(transport.time, Number(output.props.rangeEnd ?? transport.time)));
    const plan = evaluateComposition(graph(), { compositionId: output.props.compositionId, time });
    const sourceCanvas = document.createElement("canvas");
    const result = await renderPlanToCanvas2D(sourceCanvas, plan, { assetResolver: (assetId) => graph().nodes[assetId], frameProvider });
    const targetCanvas = document.createElement("canvas");
    targetCanvas.width = Number(output.props.width);
    targetCanvas.height = Number(output.props.height);
    targetCanvas.getContext("2d").drawImage(sourceCanvas, 0, 0, targetCanvas.width, targetCanvas.height);
    const blob = await canvasToBlob(targetCanvas, "image/png");
    downloadBlob(blob, `${safeFilename(output.name)}-${String(plan.frame).padStart(6, "0")}.png`);
    persistenceStatus = "Still frame rendered locally";
    activity.unshift({ title: "Frame rendered", detail: `${output.name} frame ${plan.frame} at ${formatTime(time)} using ${result.errors.length ? `${result.errors.length} offline/failed source(s)` : "all available sources"}.`, operations: ["evaluate", "decode", "composite", "png"] });
  } catch (error) {
    persistenceStatus = "Render failed";
    activity.unshift({ title: "Frame render failed", detail: error.message, operations: [] });
  }
  render();
}

function executeTransportAction(action) {
  if (action === "toggle") {
    if (transport.playing) stopTransportPlayback(); else startTransportPlayback();
    updateTransportDom(); return;
  }
  stopTransportPlayback();
  if (action === "step-back") transport = stepTransport(transport, -1);
  if (action === "step-forward") transport = stepTransport(transport, 1);
  if (action === "start") transport = seekTransport(transport, 0);
  updateTransportDom(); syncPreviewMedia();
}
function startTransportPlayback() {
  transport = playTransport(transport.time >= transport.duration ? seekTransport(transport, 0) : transport);
  transportLastTick = performance.now();
  audioMixer.play(graph(), transport.time).then((result) => {
    if (result?.scheduled) persistenceStatus = `Playing ${result.scheduled} audio source${result.scheduled === 1 ? "" : "s"}`;
  }).catch(() => {});
  const media = document.querySelector(".cut-preview video");
  const node = selectedNode();
  if (media && node.kind === "clip") {
    try { media.muted = true; media.currentTime = sourceTimeForClip(node, transport.time); media.playbackRate = Number(node.props.playbackRate ?? 1); media.play().catch(() => {}); } catch {}
  }
  const loop = (now) => {
    const elapsed = (now - transportLastTick) / 1000;
    transportLastTick = now;
    transport = tickTransport(transport, elapsed);
    updateTransportDom();
    if (transport.playing) transportFrame = requestAnimationFrame(loop);
    else { transportFrame = null; audioMixer.stop(); document.querySelector(".cut-preview video, .cut-preview audio")?.pause?.(); }
  };
  transportFrame = requestAnimationFrame(loop);
}
function stopTransportPlayback() {
  transport = pauseTransport(transport);
  if (transportFrame) cancelAnimationFrame(transportFrame);
  transportFrame = null;
  audioMixer.stop();
  document.querySelector(".cut-preview video, .cut-preview audio")?.pause?.();
}
function updateTransportDom() {
  const duration = currentTimelineDuration();
  const ratio = Math.min(1, Math.max(0, transport.time / duration));
  const shell = document.querySelector(".timeline-shell");
  if (shell) shell.style.setProperty("--playhead", ratio);
  const timecode = document.querySelector("#timecode");
  if (timecode) timecode.textContent = formatTime(transport.time);
  const play = document.querySelector("#transport-play");
  if (play) play.textContent = transport.playing ? "❚❚" : "▶";
  const motionPlayhead = document.querySelector("#motion-playhead");
  if (motionPlayhead) motionPlayhead.style.left = `${Math.min(100, (transport.time / duration) * 100)}%`;
  updateAnimatedLayerDom();
}
function updateAnimatedLayerDom() {
  const comp = composition();
  if (!comp) return;
  document.querySelectorAll("[data-layer-id]").forEach((element) => {
    const node = graph().nodes[element.dataset.layerId];
    if (!node) return;
    const transform = evaluateAnimatedTransform(node, transport.time);
    element.style.left = `${50 + (transform.x / Number(comp.props.width)) * 100}%`;
    element.style.top = `${50 + (transform.y / Number(comp.props.height)) * 100}%`;
    element.style.opacity = transform.opacity;
    element.style.transform = `translate(-50%,-50%) rotate(${transform.rotation}deg) scale(${transform.scaleX},${transform.scaleY})`;
    element.style.clipPath = `inset(${transform.cropTop * 100}% ${transform.cropRight * 100}% ${transform.cropBottom * 100}% ${transform.cropLeft * 100}%)`;
    element.style.filter = cssFilterForNode(node);
  });
}

function syncPreviewMedia() {
  const media = document.querySelector(".cut-preview video, .cut-preview audio");
  const node = selectedNode();
  if (!media || node.kind !== "clip") return;
  try { media.currentTime = Math.max(0, sourceTimeForClip(node, transport.time)); } catch {}
}

function bindTimelineSeek() {
  document.querySelectorAll(".track-lane, [data-seek-ruler]").forEach((element) => element.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".clip")) return;
    const rect = element.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    stopTransportPlayback();
    transport = seekTransport(transport, ratio * currentTimelineDuration());
    updateTransportDom(); syncPreviewMedia();
  }));
}
function bindTimelineDragging() {
  document.querySelectorAll("[data-clip-id]").forEach((clipElement) => clipElement.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const clipId = clipElement.dataset.clipId;
    const clip = graph().nodes[clipId];
    const lane = clipElement.closest(".track-lane");
    if (!clip || !lane || graph().nodes[clip.props.trackId]?.props.locked) return;
    selectedId = clipId;
    document.querySelectorAll(".clip.selected").forEach((item) => item.classList.remove("selected"));
    clipElement.classList.add("selected");
    const startX = event.clientX;
    const originalStart = Number(clip.props.start ?? 0);
    const laneWidth = lane.getBoundingClientRect().width;
    const duration = currentTimelineDuration();
    let lastStart = originalStart;
    let moved = false;
    clipElement.setPointerCapture(event.pointerId);
    const move = (moveEvent) => {
      const deltaSeconds = ((moveEvent.clientX - startX) / laneWidth) * duration;
      lastStart = Math.max(0, originalStart + deltaSeconds);
      clipElement.style.left = `${Math.min(100, (lastStart / duration) * 100)}%`;
      moved = Math.abs(moveEvent.clientX - startX) > 2;
    };
    const up = () => {
      clipElement.removeEventListener("pointermove", move);
      clipElement.removeEventListener("pointerup", up);
      if (moved) applyEdit("Drag clip", moveClipOperations(graph(), clipId, { start: lastStart, snap: true, tolerance: 0.25 }));
      else render();
    };
    clipElement.addEventListener("pointermove", move);
    clipElement.addEventListener("pointerup", up, { once: true });
  }));
}
function bindCanvasDragging() {
  document.querySelectorAll("[data-layer-id]").forEach((layerElement) => layerElement.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const layerId = layerElement.dataset.layerId;
    const layer = graph().nodes[layerId];
    const stage = document.querySelector("[data-canvas-stage]");
    if (!layer || !stage) return;
    selectedId = layerId;
    document.querySelectorAll(".canvas-layer.selected").forEach((item) => item.classList.remove("selected"));
    layerElement.classList.add("selected");
    const transform = evaluateAnimatedTransform(layer, transport.time);
    const startX = event.clientX;
    const startY = event.clientY;
    const rect = stage.getBoundingClientRect();
    const comp = composition();
    let moved = false;
    let nextX = transform.x;
    let nextY = transform.y;
    layerElement.setPointerCapture(event.pointerId);
    const move = (moveEvent) => {
      nextX = transform.x + ((moveEvent.clientX - startX) / rect.width) * Number(comp.props.width);
      nextY = transform.y + ((moveEvent.clientY - startY) / rect.height) * Number(comp.props.height);
      const left = 50 + (nextX / Number(comp.props.width)) * 100;
      const top = 50 + (nextY / Number(comp.props.height)) * 100;
      layerElement.style.left = `${left}%`; layerElement.style.top = `${top}%`;
      moved = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 2;
    };
    const up = () => {
      layerElement.removeEventListener("pointermove", move);
      if (moved) applyEdit("Drag Canvas layer", transformNodeOperations(graph(), layerId, { x: nextX, y: nextY }));
      else render();
    };
    layerElement.addEventListener("pointermove", move);
    layerElement.addEventListener("pointerup", up, { once: true });
  }));
}

async function importFiles(event) {
  const files = [...(event.target.files ?? [])];
  if (!files.length) return;
  persistenceStatus = `Analyzing ${files.length} media file${files.length === 1 ? "" : "s"}…`; render();
  let next = graph();
  const saved = [];
  for (const file of files) {
    const metadata = await probeMedia(file);
    let asset = createAsset({ name: file.name, mimeType: file.type, size: file.size, ...metadata });
    asset = { ...asset, props: { ...asset.props, uri: localAssetUri(asset.id) } };
    next = addAsset(next, asset);
    saved.push([asset, file]);
    assetUrls.set(asset.id, URL.createObjectURL(file));
  }
  history = commit(history, next, `Import ${files.length} media file${files.length === 1 ? "" : "s"}`);
  await Promise.all(saved.map(([asset, file]) => saveAssetBlob(asset.id, file, { ...asset.props, name: asset.name }).catch(() => false)));
  frameProvider.clear(); audioMixer.clearCache();
  await persistGraph();
  const newestAsset = nodesByKind(graph(), "asset").at(-1);
  if (newestAsset) selectedId = newestAsset.id;
  activity.unshift({ title: "Media imported", detail: `${files.length} asset${files.length === 1 ? "" : "s"} analyzed, fingerprinted and persisted. Audio assets include lightweight waveform data when decoding is available.`, operations: ["probe", "node.add", "edge.add", "indexeddb.put"] });
  render();
}

async function relinkSelectedAsset(event) {
  const assetId = selectedNode().kind === "asset" ? selectedNode().id : null;
  const file = event.target.files?.[0];
  if (!assetId || !file) return;
  const asset = graph().nodes[assetId];
  const incomingKind = mediaKindFromMime(file.type);
  if (incomingKind !== asset.props.mediaKind && !(incomingKind === "audio" && asset.props.mediaKind === "music")) {
    activity.unshift({ title: "Relink rejected", detail: `Expected ${asset.props.mediaKind} media but received ${incomingKind}.`, operations: [] }); render(); return;
  }
  persistenceStatus = `Analyzing replacement for ${asset.name}…`; render();
  const metadata = await probeMedia(file);
  await saveAssetBlob(asset.id, file, { ...asset.props, ...metadata, name: file.name, mimeType: file.type, size: file.size });
  if (assetUrls.has(asset.id)) URL.revokeObjectURL(assetUrls.get(asset.id));
  assetUrls.set(asset.id, URL.createObjectURL(file));
  frameProvider.clear(); audioMixer.clearCache();
  const patch = { uri: localAssetUri(asset.id), mimeType: file.type, size: file.size, ...metadata };
  applyEdit(`Relink ${asset.name}`, [{ type: "node.update", nodeId: asset.id, patch: { props: patch } }], { selectId: asset.id });
}

async function importProjectFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    stopTransportPlayback();
    const parsed = parseProjectFile(await file.text());
    history = createHistory(parsed.graph);
    selectedId = graph().projectId;
    workspace = "canvas";
    syncTransport(); transport = seekTransport(transport, 0);
    const fingerprintMatches = await hydrateAssetUrls();
    await persistGraph();
    const matchDetail = fingerprintMatches ? ` ${fingerprintMatches} source${fingerprintMatches === 1 ? "" : "s"} were relinked automatically by fingerprint.` : "";
    activity.unshift({ title: "Project opened", detail: `${parsed.migratedFrom ? `Opened and migrated ${parsed.migratedFrom}.` : `Opened Media project file v${parsed.fileVersion}.`}${matchDetail}`, operations: ["deserialize", "validate", "hydrate", ...(fingerprintMatches ? ["fingerprint-relink"] : [])] });
  } catch (error) { activity.unshift({ title: "Project open failed", detail: error.message, operations: [] }); }
  render();
}

async function executeIntent(intent) {
  if (!intent?.trim()) return;
  const lower = intent.trim().toLowerCase();
  if (lower === "undo") { history = undo(history); persistGraph(); render(); return; }
  if (lower === "redo") { history = redo(history); persistGraph(); render(); return; }
  try {
    const plan = await planWithProvider(plannerRegistry.get("local"), graph(), intent, { selectedId, time: transport.time, workspace });
    if (plan.operations.length) history = commit(history, applyOperations(graph(), plan.operations), plan.summary);
    activity.unshift({ title: intent, detail: plan.summary, operations: plan.operations.map((operation) => operation.type) });
    await persistGraph();
  } catch (error) { activity.unshift({ title: `${intent} failed`, detail: error.message, operations: [] }); }
  render();
}

function exportProject() {
  const portable = structuredClone(graph());
  for (const asset of nodesByKind(portable, "asset")) {
    if (assetUrls.has(asset.id) || String(asset.props.uri).startsWith("media://") || String(asset.props.uri).startsWith("blob:")) asset.props.uri = localAssetUri(asset.id);
  }
  const manifest = buildSourceManifest(portable);
  const payload = serializeProject(portable, { appVersion: APP_VERSION, exportedAt: new Date().toISOString(), sourceCount: manifest.length });
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeFilename(portable.nodes[portable.projectId].name || "project")}.media.json`;
  anchor.click(); URL.revokeObjectURL(url);
}

async function persistGraph() {
  try {
    assertProjectInvariants(graph());
    const saved = await saveStoredGraph(graph());
    persistenceStatus = saved ? "Saved locally" : "Session-only storage";
  } catch (error) { persistenceStatus = `Local save unavailable: ${error.message}`; }
}
async function hydrateAssetUrls() {
  for (const url of assetUrls.values()) URL.revokeObjectURL(url);
  assetUrls.clear();
  let fingerprintMatches = 0;
  await Promise.all(nodesByKind(graph(), "asset").map(async (asset) => {
    let blob = await loadAssetBlob(asset.id).catch(() => null);
    if (!blob && asset.props.hash) {
      const stored = await findStoredAssetByHash(asset.props.hash).catch(() => null);
      if (stored?.blob) {
        blob = stored.blob;
        fingerprintMatches += 1;
        await saveAssetBlob(asset.id, blob, { ...asset.props, name: asset.name }).catch(() => false);
      }
    }
    if (blob) assetUrls.set(asset.id, URL.createObjectURL(blob));
  }));
  return fingerprintMatches;
}

async function resolveAssetBlob(assetId, asset) {
  const direct = await loadAssetBlob(assetId).catch(() => null);
  if (direct) return direct;
  if (asset?.props?.hash) {
    const stored = await findStoredAssetByHash(asset.props.hash).catch(() => null);
    if (stored?.blob) return stored.blob;
  }
  const uri = previewUri(asset);
  if (uri && !uri.startsWith("blob:")) {
    try { return await fetch(uri).then((response) => response.ok ? response.blob() : null); } catch {}
  }
  return null;
}

async function bootstrap() {
  try {
    const stored = await loadStoredGraph();
    if (stored) {
      assertProjectInvariants(stored);
      history = createHistory(stored);
      selectedId = graph().projectId;
      persistenceStatus = "Restored local workspace";
      activity[0] = { title: "Workspace restored", detail: "Project graph and local source blobs were restored from IndexedDB.", operations: [] };
    }
    await hydrateAssetUrls();
  } catch (error) { persistenceStatus = `Started fresh workspace: ${error.message}`; }
  syncTransport(); render();
}

document.addEventListener("keydown", (event) => {
  const modifier = event.metaKey || event.ctrlKey;
  if (modifier && event.key.toLowerCase() === "z") {
    event.preventDefault(); history = event.shiftKey ? redo(history) : undo(history); persistGraph(); render(); return;
  }
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (event.code === "Space" && ["cut", "motion"].includes(workspace)) { event.preventDefault(); executeTransportAction("toggle"); }
  if (event.key === "ArrowLeft" && ["cut", "motion"].includes(workspace)) { event.preventDefault(); executeTransportAction("step-back"); }
  if (event.key === "ArrowRight" && ["cut", "motion"].includes(workspace)) { event.preventDefault(); executeTransportAction("step-forward"); }
  if (event.key.toLowerCase() === "m" && ["cut", "motion"].includes(workspace)) { event.preventDefault(); executeIntent(`add marker Marker at ${transport.time.toFixed(3)}s`); }
  if (event.key.toLowerCase() === "s" && workspace === "cut" && selectedNode().kind === "clip") { event.preventDefault(); executeTimelineAction("split"); }
  if (event.key.toLowerCase() === "b" && workspace === "cut") { event.preventDefault(); const operations = bladeAllAtTimeOperations(graph(), transport.time); if (operations.length) applyEdit("Blade all at playhead", operations); }
});

await bootstrap();
