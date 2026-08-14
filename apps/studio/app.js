import {
  addAsset,
  applyOperations,
  assertValidGraph,
  commit,
  createAsset,
  createHistory,
  createMediaProject,
  nodesByKind,
  parseProjectFile,
  planIntent,
  redo,
  rippleDeleteClipOperations,
  serializeProject,
  splitClipOperations,
  timelineDuration,
  trimClipOperations,
  moveClipOperations,
  undo,
} from "/packages/core/src/index.js";
import { loadAssetBlob, loadStoredGraph, localAssetUri, saveAssetBlob, saveStoredGraph } from "./storage.js";

const app = document.querySelector("#app");
let history = createHistory(createMediaProject("Untitled project"));
let workspace = "canvas";
let selectedId = history.present.projectId;
let persistenceStatus = "Local workspace ready";
const assetUrls = new Map();
let activity = [{ title: "Project created", detail: "Universal Creative Graph ready for image, video and audio assets.", operations: [] }];

const graph = () => history.present;
const selectedNode = () => graph().nodes[selectedId] ?? graph().nodes[graph().projectId];
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

function mediaGlyph(kind) {
  return { image: "◫", video: "▶", audio: "≋", music: "♪", vector: "◇", unknown: "·" }[kind] ?? "·";
}

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function previewUri(node) {
  if (!node || node.kind !== "asset") return "";
  const uri = String(node.props.uri ?? "");
  if (uri.startsWith("media://asset/")) return assetUrls.get(node.id) ?? "";
  return uri;
}

function renderPreview(node) {
  if (!node || node.kind !== "asset") {
    const composition = nodesByKind(graph(), "composition")[0];
    return `<div class="composition-frame" style="aspect-ratio:${composition?.props.width ?? 16}/${composition?.props.height ?? 9}"><div class="empty-stage"><div class="stage-mark">M</div><h2>One project, every medium.</h2><p>Import image, video or audio. The same asset can then appear in Canvas, Cut and future workspaces without duplicate project files.</p></div></div>`;
  }
  const uri = escapeHtml(previewUri(node));
  const label = escapeHtml(node.name);
  if (!uri) return `<div class="composition-frame"><div class="empty-stage"><h2>${label}</h2><p>The project knows this asset, but its local media is offline. Re-import/relink support is the next storage step.</p></div></div>`;
  if (node.props.mediaKind === "image") return `<div class="composition-frame media-frame"><img src="${uri}" alt="${label}" /></div>`;
  if (node.props.mediaKind === "video") return `<div class="composition-frame media-frame"><video src="${uri}" controls playsinline></video></div>`;
  if (node.props.mediaKind === "audio") return `<div class="composition-frame audio-frame"><div class="audio-art">≋</div><h2>${label}</h2><audio src="${uri}" controls></audio></div>`;
  return `<div class="composition-frame"><div class="empty-stage"><h2>${label}</h2><p>Preview support for this media kind is not implemented yet.</p></div></div>`;
}

function renderCanvas() {
  return `<section class="workspace canvas-workspace"><div class="workspace-toolbar"><span class="eyebrow">CANVAS</span><span class="toolbar-copy">Spatial view of the selected creative object</span></div><div class="stage-wrap">${renderPreview(selectedNode())}</div></section>`;
}

function renderTimelineControls() {
  const node = selectedNode();
  if (node.kind !== "clip") return `<span class="timeline-hint">Select a clip to edit it.</span>`;
  return `<div class="timeline-actions" style="display:flex;gap:6px;align-items:center;overflow:auto">
    <button class="quiet-button" data-timeline-action="nudge-back">−1s</button>
    <button class="quiet-button" data-timeline-action="nudge-forward">+1s</button>
    <button class="quiet-button" data-timeline-action="trim-start">Trim in +1s</button>
    <button class="quiet-button" data-timeline-action="trim-end">Trim out −1s</button>
    <button class="quiet-button" data-timeline-action="split">Split middle</button>
    <button class="quiet-button" data-timeline-action="ripple-delete">Ripple delete</button>
  </div>`;
}

function renderTimeline() {
  const composition = nodesByKind(graph(), "composition")[0];
  const tracks = nodesByKind(graph(), "track").sort((a, b) => a.props.order - b.props.order);
  const clips = nodesByKind(graph(), "clip");
  const duration = Math.max(Number(composition?.props.duration ?? 30), Math.ceil(timelineDuration(graph(), 0)));
  const ruler = Array.from({ length: 7 }, (_, index) => `<span style="left:${(index / 6) * 100}%">${Math.round((duration / 6) * index)}s</span>`).join("");
  return `<div class="timeline-region" style="height:230px;display:grid;grid-template-rows:38px minmax(0,1fr)"><div class="timeline-editbar" style="display:flex;align-items:center;padding:4px 10px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:#0d0f12">${renderTimelineControls()}</div><div class="timeline-shell" style="min-height:0"><div class="ruler">${ruler}</div>${tracks.map((track) => {
    const trackClips = clips.filter((clip) => clip.props.trackId === track.id);
    return `<div class="track-row"><div class="track-label"><strong>${escapeHtml(track.name)}</strong><span>${escapeHtml(track.props.mediaKind)}</span></div><div class="track-lane">${trackClips.map((clip) => {
      const left = Math.min(100, (Number(clip.props.start ?? 0) / duration) * 100);
      const width = Math.max(4, Math.min(100 - left, (Number(clip.props.duration ?? 1) / duration) * 100));
      const asset = graph().nodes[clip.props.assetId];
      return `<button class="clip ${clip.id === selectedId ? "selected" : ""}" data-select="${clip.id}" style="left:${left}%;width:${width}%"><span>${mediaGlyph(asset?.props.mediaKind)}</span>${escapeHtml(clip.name)}</button>`;
    }).join("")}${trackClips.length === 0 ? '<span class="track-empty">Use “Add everything to timeline” in Agent</span>' : ""}</div></div>`;
  }).join("")}</div></div>`;
}

function renderCut() {
  return `<section class="workspace cut-workspace"><div class="workspace-toolbar"><span class="eyebrow">CUT</span><span class="toolbar-copy">Move, trim, split and ripple-delete through graph operations</span></div><div class="cut-preview">${renderPreview(selectedNode())}</div>${renderTimeline()}</section>`;
}

function renderAgent() {
  const suggestions = ["Add everything to the timeline", "Make it vertical 9:16", "Rename project to Product launch", "Clear the timeline"];
  return `<section class="workspace agent-workspace"><div class="agent-hero"><span class="eyebrow">AGENT / LOCAL PLANNER</span><h1>Describe an edit. Inspect the operations.</h1><p>Intent stays separate from mutation. Deterministic rules currently emit the same validated operation batches that future model providers will target.</p></div><form id="agent-form" class="command-box"><textarea id="agent-input" rows="3" placeholder="e.g. Add everything to the timeline"></textarea><div class="command-footer"><div class="suggestions">${suggestions.map((item) => `<button type="button" data-command="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join("")}</div><button class="primary-button" type="submit">Plan & apply</button></div></form><div class="activity-list">${activity.map((item) => `<article class="activity-card"><div><span class="activity-dot"></span><strong>${escapeHtml(item.title)}</strong></div><p>${escapeHtml(item.detail)}</p>${item.operations.length ? `<code>${escapeHtml(item.operations.join("  ·  "))}</code>` : ""}</article>`).join("")}</div></section>`;
}

function renderAssets() {
  const assets = nodesByKind(graph(), "asset");
  if (!assets.length) return `<div class="library-empty"><strong>No media yet</strong><span>Import local files to populate the creative graph.</span></div>`;
  return assets.map((asset) => `<button class="asset-row ${selectedId === asset.id ? "selected" : ""}" data-select="${asset.id}"><span class="asset-glyph">${mediaGlyph(asset.props.mediaKind)}</span><span class="asset-copy"><strong>${escapeHtml(asset.name)}</strong><small>${escapeHtml(asset.props.mediaKind)} · ${formatBytes(asset.props.size)}</small></span></button>`).join("");
}

function renderInspector() {
  const node = selectedNode();
  return `<aside class="inspector"><div class="panel-heading"><span>INSPECTOR</span><small>${escapeHtml(node.kind)}</small></div><div class="inspector-name">${escapeHtml(node.name)}</div><dl><div><dt>ID</dt><dd title="${escapeHtml(node.id)}">${escapeHtml(node.id.slice(0, 18))}…</dd></div>${Object.entries(node.props).filter(([key]) => key !== "uri").slice(0, 12).map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl><div class="graph-stats"><span><strong>${Object.keys(graph().nodes).length}</strong> nodes</span><span><strong>${Object.keys(graph().edges).length}</strong> edges</span></div></aside>`;
}

function render() {
  const project = graph().nodes[graph().projectId];
  app.innerHTML = `<div class="shell"><header class="topbar"><div class="brand"><span class="brand-mark">M</span><strong>MEDIA</strong><span class="alpha">ALPHA</span></div><div class="project-title">${escapeHtml(project.name)}</div><div class="top-actions"><button id="undo" class="icon-button" ${history.past.length ? "" : "disabled"} title="Undo">↶</button><button id="redo" class="icon-button" ${history.future.length ? "" : "disabled"} title="Redo">↷</button><button id="export" class="quiet-button">Export project</button><label class="quiet-button file-button">Open project<input id="project-input" type="file" accept=".media.json,application/json" /></label><label class="primary-button file-button">Import media<input id="file-input" type="file" multiple accept="image/*,video/*,audio/*,.svg" /></label></div></header><div class="body-grid"><aside class="left-panel"><nav class="workspace-nav">${[["canvas", "◫", "Canvas"], ["cut", "▤", "Cut"], ["agent", "✦", "Agent"]].map(([id, icon, name]) => `<button data-workspace="${id}" class="${workspace === id ? "active" : ""}"><span>${icon}</span>${name}</button>`).join("")}</nav><div class="library"><div class="panel-heading"><span>LIBRARY</span><small>${nodesByKind(graph(), "asset").length}</small></div><div class="asset-list">${renderAssets()}</div></div></aside><main class="main-panel">${workspace === "canvas" ? renderCanvas() : workspace === "cut" ? renderCut() : renderAgent()}</main>${renderInspector()}</div><footer class="statusbar"><span><i></i>${escapeHtml(persistenceStatus)}</span><span>Graph v${graph().version}</span><span>${history.past.length} edits</span></footer></div>`;
  bindEvents();
}

function bindEvents() {
  document.querySelectorAll("[data-workspace]").forEach((button) => button.addEventListener("click", () => { workspace = button.dataset.workspace; render(); }));
  document.querySelectorAll("[data-select]").forEach((button) => button.addEventListener("click", () => { selectedId = button.dataset.select; render(); }));
  document.querySelectorAll("[data-timeline-action]").forEach((button) => button.addEventListener("click", () => executeTimelineAction(button.dataset.timelineAction)));
  document.querySelector("#file-input")?.addEventListener("change", importFiles);
  document.querySelector("#project-input")?.addEventListener("change", importProjectFile);
  document.querySelector("#export")?.addEventListener("click", exportProject);
  document.querySelector("#undo")?.addEventListener("click", () => { history = undo(history); selectedId = graph().nodes[selectedId] ? selectedId : graph().projectId; persistGraph(); render(); });
  document.querySelector("#redo")?.addEventListener("click", () => { history = redo(history); persistGraph(); render(); });
  document.querySelector("#agent-form")?.addEventListener("submit", (event) => { event.preventDefault(); executeIntent(document.querySelector("#agent-input").value); });
  document.querySelectorAll("[data-command]").forEach((button) => button.addEventListener("click", () => executeIntent(button.dataset.command)));
}

async function mediaMetadata(file) {
  if (file.type.startsWith("image/") && "createImageBitmap" in globalThis) {
    try {
      const bitmap = await createImageBitmap(file);
      const metadata = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return metadata;
    } catch { return {}; }
  }
  if (!file.type.startsWith("video/") && !file.type.startsWith("audio/")) return {};
  const element = document.createElement(file.type.startsWith("video/") ? "video" : "audio");
  const url = URL.createObjectURL(file);
  try {
    const metadata = await new Promise((resolve) => {
      const done = () => resolve({ duration: Number.isFinite(element.duration) ? element.duration : undefined, width: element.videoWidth || undefined, height: element.videoHeight || undefined });
      element.addEventListener("loadedmetadata", done, { once: true });
      element.addEventListener("error", () => resolve({}), { once: true });
      element.src = url;
    });
    return metadata;
  } finally { URL.revokeObjectURL(url); }
}

async function importFiles(event) {
  const files = [...event.target.files];
  if (!files.length) return;
  let next = graph();
  const saved = [];
  for (const file of files) {
    const metadata = await mediaMetadata(file);
    let asset = createAsset({ name: file.name, mimeType: file.type, size: file.size, ...metadata });
    asset = { ...asset, props: { ...asset.props, uri: localAssetUri(asset.id) } };
    next = addAsset(next, asset);
    saved.push([asset, file]);
    assetUrls.set(asset.id, URL.createObjectURL(file));
  }
  history = commit(history, next, `Import ${files.length} media file${files.length === 1 ? "" : "s"}`);
  await Promise.all(saved.map(([asset, file]) => saveAssetBlob(asset.id, file).catch(() => false)));
  await persistGraph();
  const newestAsset = nodesByKind(graph(), "asset").at(-1);
  if (newestAsset) selectedId = newestAsset.id;
  activity.unshift({ title: "Media imported", detail: `${files.length} asset${files.length === 1 ? "" : "s"} added with local metadata and persistent media storage.`, operations: ["node.add", "edge.add", "indexeddb.put"] });
  render();
}

async function importProjectFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const parsed = parseProjectFile(await file.text());
    history = createHistory(parsed.graph);
    selectedId = graph().projectId;
    workspace = "canvas";
    await hydrateAssetUrls();
    await persistGraph();
    activity.unshift({ title: "Project opened", detail: parsed.migratedFrom ? `Opened and migrated ${parsed.migratedFrom}.` : `Opened Media project file v${parsed.fileVersion}.`, operations: ["deserialize", "validate"] });
  } catch (error) {
    activity.unshift({ title: "Project open failed", detail: error.message, operations: [] });
  }
  render();
}

function applyEdit(label, operations) {
  try {
    const next = applyOperations(graph(), operations);
    history = commit(history, next, label);
    activity.unshift({ title: label, detail: `${operations.length} validated operation${operations.length === 1 ? "" : "s"} applied.`, operations: operations.map((operation) => operation.type) });
    persistGraph();
  } catch (error) {
    activity.unshift({ title: `${label} failed`, detail: error.message, operations: [] });
  }
  render();
}

function executeTimelineAction(action) {
  const clip = selectedNode();
  if (clip.kind !== "clip") return;
  const start = Number(clip.props.start ?? 0);
  const duration = Number(clip.props.duration ?? 0);
  if (action === "nudge-back") return applyEdit("Move clip back 1s", moveClipOperations(graph(), clip.id, { start: Math.max(0, start - 1) }));
  if (action === "nudge-forward") return applyEdit("Move clip forward 1s", moveClipOperations(graph(), clip.id, { start: start + 1 }));
  if (action === "trim-start") return applyEdit("Trim clip start", trimClipOperations(graph(), clip.id, { edge: "start", time: start + Math.min(1, duration / 2) }));
  if (action === "trim-end") return applyEdit("Trim clip end", trimClipOperations(graph(), clip.id, { edge: "end", time: start + Math.max(duration / 2, duration - 1) }));
  if (action === "split") return applyEdit("Split clip", splitClipOperations(graph(), clip.id, start + duration / 2));
  if (action === "ripple-delete") {
    const operations = rippleDeleteClipOperations(graph(), clip.id);
    selectedId = graph().projectId;
    return applyEdit("Ripple delete clip", operations);
  }
}

function executeIntent(intent) {
  if (!intent?.trim()) return;
  const lower = intent.trim().toLowerCase();
  if (lower === "undo") { history = undo(history); persistGraph(); render(); return; }
  if (lower === "redo") { history = redo(history); persistGraph(); render(); return; }
  const plan = planIntent(graph(), intent);
  if (plan.operations.length) {
    try { history = commit(history, applyOperations(graph(), plan.operations), plan.summary); persistGraph(); }
    catch (error) { activity.unshift({ title: intent, detail: error.message, operations: [] }); render(); return; }
  }
  activity.unshift({ title: intent, detail: plan.summary, operations: plan.operations.map((operation) => operation.type) });
  render();
}

function exportProject() {
  const portable = structuredClone(graph());
  for (const asset of nodesByKind(portable, "asset")) {
    if (String(asset.props.uri).startsWith("blob:") || String(asset.props.uri).startsWith("media://")) asset.props.uri = "";
  }
  const blob = new Blob([serializeProject(portable, { appVersion: "0.2.0", exportedAt: new Date().toISOString() })], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${portable.nodes[portable.projectId].name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "project"}.media.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function persistGraph() {
  try {
    const saved = await saveStoredGraph(graph());
    persistenceStatus = saved ? "Saved locally" : "Session-only storage";
  } catch {
    persistenceStatus = "Local save unavailable";
  }
}

async function hydrateAssetUrls() {
  for (const url of assetUrls.values()) URL.revokeObjectURL(url);
  assetUrls.clear();
  await Promise.all(nodesByKind(graph(), "asset").map(async (asset) => {
    if (!String(asset.props.uri ?? "").startsWith("media://asset/")) return;
    const blob = await loadAssetBlob(asset.id).catch(() => null);
    if (blob) assetUrls.set(asset.id, URL.createObjectURL(blob));
  }));
}

async function bootstrap() {
  try {
    const stored = await loadStoredGraph();
    if (stored) {
      assertValidGraph(stored);
      history = createHistory(stored);
      selectedId = graph().projectId;
      persistenceStatus = "Restored local workspace";
      activity[0] = { title: "Workspace restored", detail: "Project graph and locally stored media were restored from IndexedDB.", operations: [] };
    }
    await hydrateAssetUrls();
  } catch {
    persistenceStatus = "Started fresh workspace";
  }
  render();
}

document.addEventListener("keydown", (event) => {
  const modifier = event.metaKey || event.ctrlKey;
  if (!modifier || event.key.toLowerCase() !== "z") return;
  event.preventDefault();
  history = event.shiftKey ? redo(history) : undo(history);
  persistGraph();
  render();
});

await bootstrap();
