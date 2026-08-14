import {
  effectsForTarget,
  evaluateAnimatedTransform,
  evaluateComposition,
  keyframeSummary,
  nodesByKind,
  transformForNode,
} from "/packages/core/src/index.js";

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const mediaGlyph = (kind) => ({ image: "◫", video: "▶", audio: "≋", music: "♪", vector: "◇", unknown: "·" }[kind] ?? "·");

export function formatTime(seconds = 0) {
  const value = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(value / 60);
  const whole = Math.floor(value % 60);
  const millis = Math.floor((value % 1) * 1000);
  return `${String(minutes).padStart(2, "0")}:${String(whole).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function createStudioView({ graph, selectedNode, composition, previewUri, currentTimelineDuration, getTransport, capabilities, getCompositorBackend }) {
  const assetForNode = (node) => {
    if (!node) return null;
    if (node.kind === "asset") return node;
    if (["clip", "layer"].includes(node.kind)) return graph().nodes[node.props.assetId] ?? null;
    return null;
  };

  const cssFilterForNode = (node) => {
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
  };

  function activePreviewAsset() {
    const direct = assetForNode(selectedNode());
    if (direct) return direct;
    try {
      const plan = evaluateComposition(graph(), { time: getTransport().time });
      const active = [...plan.visual].reverse().find((item) => item.kind === "clip");
      return active ? graph().nodes[active.assetId] : null;
    } catch { return null; }
  }

  function renderMedia(asset, { controls = true, canvasLayer = false } = {}) {
    if (!asset) return `<div class="empty-stage"><div class="stage-mark">M</div><h2>One project, every medium.</h2><p>Import media, then place the same asset on Canvas or Cut without creating application-specific copies.</p></div>`;
    const uri = escapeHtml(previewUri(asset));
    if (!uri) return `<div class="empty-stage offline"><div class="offline-mark">!</div><h2>${escapeHtml(asset.name)}</h2><p>Media is offline. Select the asset and use Relink source in the Inspector.</p></div>`;
    const label = escapeHtml(asset.name);
    if (["image", "vector"].includes(asset.props.mediaKind)) return `<img src="${uri}" alt="${label}" draggable="false" />`;
    if (asset.props.mediaKind === "video") return `<video src="${uri}" ${controls && !canvasLayer ? "controls" : "muted"} playsinline preload="metadata"></video>`;
    if (["audio", "music"].includes(asset.props.mediaKind)) return `<div class="audio-preview"><div class="audio-art">≋</div><strong>${label}</strong>${controls ? `<audio src="${uri}" controls preload="metadata"></audio>` : ""}</div>`;
    return `<div class="empty-stage"><h2>${label}</h2><p>Preview support for ${escapeHtml(asset.props.mediaKind)} is not implemented yet.</p></div>`;
  }

  function renderCanvasLayer(layer, comp) {
    const asset = graph().nodes[layer.props.assetId];
    const transform = evaluateAnimatedTransform(layer, getTransport().time);
    const left = 50 + (transform.x / Number(comp.props.width)) * 100;
    const top = 50 + (transform.y / Number(comp.props.height)) * 100;
    const clipPath = `inset(${transform.cropTop * 100}% ${transform.cropRight * 100}% ${transform.cropBottom * 100}% ${transform.cropLeft * 100}%)`;
    return `<button class="canvas-layer ${layer.id === selectedNode().id ? "selected" : ""}" data-layer-id="${layer.id}" data-select="${layer.id}" style="left:${left}%;top:${top}%;z-index:${10 + Number(layer.props.order ?? 0)};opacity:${transform.opacity};transform:translate(-50%,-50%) rotate(${transform.rotation}deg) scale(${transform.scaleX},${transform.scaleY});clip-path:${clipPath};filter:${cssFilterForNode(layer)}">${renderMedia(asset, { controls: false, canvasLayer: true })}<span class="layer-label">${escapeHtml(layer.name)}</span></button>`;
  }

  function renderCanvasControls() {
    const node = selectedNode();
    if (node.kind === "asset" && !["audio", "music"].includes(node.props.mediaKind)) return `<button class="primary-button compact" data-canvas-action="add-layer">Add selected to Canvas</button>`;
    if (node.kind !== "layer" || node.props.role === "marker") return `<span class="toolbar-copy">Select a visual asset or layer to edit the composition.</span>`;
    return `<div class="tool-cluster"><button data-canvas-action="left">←</button><button data-canvas-action="right">→</button><button data-canvas-action="up">↑</button><button data-canvas-action="down">↓</button><span class="tool-divider"></span><button data-canvas-action="rotate-left">−15°</button><button data-canvas-action="rotate-right">+15°</button><button data-canvas-action="scale-down">− Scale</button><button data-canvas-action="scale-up">+ Scale</button><button data-canvas-action="opacity-down">− Opacity</button><button data-canvas-action="opacity-up">+ Opacity</button><button data-canvas-action="reset">Reset</button><button data-canvas-action="delete">Remove</button></div>`;
  }

  function visualLayers() {
    const comp = composition();
    return nodesByKind(graph(), "layer").filter((layer) => layer.props.role !== "marker" && layer.props.compositionId === comp?.id).sort((a, b) => Number(a.props.order ?? 0) - Number(b.props.order ?? 0));
  }

  function compositionSurface(emptyContent) {
    const comp = composition();
    const layers = visualLayers();
    return `<div class="composition-frame canvas-composition" data-canvas-stage style="aspect-ratio:${Number(comp?.props.width ?? 1920)}/${Number(comp?.props.height ?? 1080)};background:${escapeHtml(comp?.props.background ?? "#090a0d")}"><canvas class="gpu-surface" data-compositor-surface width="${Number(comp?.props.width ?? 1920)}" height="${Number(comp?.props.height ?? 1080)}"></canvas>${layers.length ? layers.map((layer) => renderCanvasLayer(layer, comp)).join("") : emptyContent}</div>`;
  }

  function renderCanvas() {
    return `<section class="workspace canvas-workspace"><div class="workspace-toolbar"><span class="eyebrow">CANVAS</span>${renderCanvasControls()}<span class="backend-badge">${escapeHtml(getCompositorBackend())}</span></div><div class="stage-wrap">${compositionSurface('<div class="empty-stage"><div class="stage-mark">M</div><h2>Canvas is nondestructive.</h2><p>Select an image or video from the Library and add it as a shared Creative Graph layer.</p></div>')}</div></section>`;
  }

  function waveformSvg(asset) {
    const values = Array.isArray(asset?.props.waveform) ? asset.props.waveform : [];
    if (!values.length) return "";
    return `<svg class="waveform" viewBox="0 0 ${values.length} 2" preserveAspectRatio="none" aria-hidden="true">${values.map((peak, index) => `<rect x="${index}" y="${1 - Number(peak)}" width="0.65" height="${Math.max(0.03, Number(peak) * 2)}"></rect>`).join("")}</svg>`;
  }

  function renderTimelineControls() {
    const node = selectedNode();
    if (node.kind !== "clip") return `<div class="tool-cluster"><button data-add-track="visual">+ Video track</button><button data-add-track="audio">+ Audio track</button><span class="timeline-hint">Drag clips to move with snapping. Select a clip for edit controls.</span></div>`;
    return `<div class="tool-cluster timeline-actions"><button data-add-track="visual">+V</button><button data-add-track="audio">+A</button><span class="tool-divider"></span><button data-timeline-action="nudge-back">−1s</button><button data-timeline-action="nudge-forward">+1s</button><button data-timeline-action="trim-start">Trim in</button><button data-timeline-action="trim-end">Trim out</button><button data-timeline-action="slip-back">Slip −1s</button><button data-timeline-action="slip-forward">Slip +1s</button><button data-timeline-action="split">Split @ playhead</button><button data-timeline-action="ripple-delete">Ripple delete</button></div>`;
  }

  function renderTransportControls() {
    const transport = getTransport();
    return `<div class="transport-controls"><button data-transport="step-back">|◀</button><button id="transport-play" data-transport="toggle" class="transport-play">${transport.playing ? "❚❚" : "▶"}</button><button data-transport="step-forward">▶|</button><button data-transport="start">↤</button><span id="timecode" class="timecode">${formatTime(transport.time)}</span><span class="fps-readout">${transport.fps} fps</span></div>`;
  }

  function renderTimeline() {
    const duration = currentTimelineDuration();
    const transport = getTransport();
    const tracks = nodesByKind(graph(), "track").sort((a, b) => Number(a.props.order ?? 0) - Number(b.props.order ?? 0));
    const clips = nodesByKind(graph(), "clip");
    const ruler = Array.from({ length: 9 }, (_, index) => `<span style="left:${(index / 8) * 100}%">${Math.round((duration / 8) * index)}s</span>`).join("");
    const markers = nodesByKind(graph(), "layer").filter((layer) => layer.props.role === "marker").map((marker) => `<i class="timeline-marker" style="left:${Math.min(100, (Number(marker.props.time ?? 0) / duration) * 100)}%" title="${escapeHtml(marker.name)} · ${formatTime(marker.props.time)}"></i>`).join("");
    const ratio = Math.min(1, transport.time / duration);
    return `<div class="timeline-region"><div class="timeline-editbar">${renderTimelineControls()}</div><div class="timeline-shell" data-timeline-duration="${duration}" style="--playhead:${ratio}"><div class="ruler" data-seek-ruler>${ruler}${markers}</div><div id="playhead" class="playhead"></div>${tracks.map((track) => {
      const trackClips = clips.filter((clip) => clip.props.trackId === track.id);
      return `<div class="track-row"><div class="track-label"><strong>${escapeHtml(track.name)}</strong><span>${escapeHtml(track.props.mediaKind)}</span><div class="track-buttons"><button data-track-action="mute" data-track-id="${track.id}" class="${track.props.muted ? "active" : ""}">M</button><button data-track-action="lock" data-track-id="${track.id}" class="${track.props.locked ? "active" : ""}">L</button></div></div><div class="track-lane" data-track-id="${track.id}">${trackClips.map((clip) => {
        const left = Math.min(100, (Number(clip.props.start ?? 0) / duration) * 100);
        const width = Math.max(1.2, Math.min(100 - left, (Number(clip.props.duration ?? 1) / duration) * 100));
        const asset = graph().nodes[clip.props.assetId];
        return `<button class="clip ${clip.id === selectedNode().id ? "selected" : ""} ${track.props.mediaKind === "audio" ? "audio-clip" : ""}" data-clip-id="${clip.id}" data-select="${clip.id}" style="left:${left}%;width:${width}%">${waveformSvg(asset)}<span class="clip-title">${mediaGlyph(asset?.props.mediaKind)} ${escapeHtml(clip.name)}</span><small>${formatTime(clip.props.start)} · ${Number(clip.props.duration).toFixed(2)}s</small></button>`;
      }).join("")}${trackClips.length ? "" : '<span class="track-empty">Empty track</span>'}</div></div>`;
    }).join("")}</div></div>`;
  }

  function renderCut() {
    return `<section class="workspace cut-workspace"><div class="workspace-toolbar"><span class="eyebrow">CUT</span>${renderTransportControls()}<span class="toolbar-copy transport-copy">Snap · trim · slip · split · ripple</span></div><div class="cut-preview"><div class="composition-frame media-frame">${renderMedia(activePreviewAsset())}</div></div>${renderTimeline()}</section>`;
  }

  function renderMotion() {
    const node = selectedNode();
    const animatable = ["layer", "clip"].includes(node.kind);
    const transform = animatable ? evaluateAnimatedTransform(node, getTransport().time) : null;
    const properties = [["x", "X position", 50], ["y", "Y position", 50], ["scaleX", "Scale", 0.1], ["rotation", "Rotation", 15], ["opacity", "Opacity", 0.1]];
    const duration = currentTimelineDuration();
    const summaries = animatable ? keyframeSummary(node) : [];
    const rows = animatable ? properties.map(([property, label, delta]) => {
      const frames = node.props.keyframes?.[property] ?? [];
      const value = transform[property];
      return `<div class="motion-row"><div><strong>${label}</strong><small>${Number(value).toFixed(property === "x" || property === "y" ? 0 : 2)} · ${frames.length} keyframe${frames.length === 1 ? "" : "s"}</small></div><div class="motion-buttons"><button data-motion-nudge="${property}" data-delta="${-delta}">−</button><button data-keyframe-prop="${property}">◆</button><button data-motion-nudge="${property}" data-delta="${delta}">+</button></div><div class="keyframe-lane">${frames.map((frame) => `<i style="left:${Math.min(100, (Number(frame.time) / duration) * 100)}%" title="${formatTime(frame.time)}"></i>`).join("")}</div></div>`;
    }).join("") : `<div class="motion-empty"><strong>Select a Canvas layer or timeline clip.</strong><span>Motion keyframes are stored on the same graph node and evaluated nondestructively.</span></div>`;
    return `<section class="workspace motion-workspace"><div class="workspace-toolbar"><span class="eyebrow">MOTION</span>${renderTransportControls()}<span class="toolbar-copy transport-copy">${summaries.reduce((sum, item) => sum + item.count, 0)} keyframes</span></div><div class="motion-preview">${compositionSurface('<div class="empty-stage"><h2>No Canvas layers yet</h2><p>Add visual media in Canvas, then animate it here.</p></div>')}</div><div class="motion-editor"><div class="motion-time"><span>${formatTime(getTransport().time)}</span><div class="motion-ruler"><i id="motion-playhead" style="left:${Math.min(100, (getTransport().time / duration) * 100)}%"></i></div></div>${rows}</div></section>`;
  }

  function renderAgent(activity) {
    const suggestions = ["Add everything to the timeline", "Make it vertical 9:16", "Make it square 1:1", "Add marker Reveal at 3s", "Set all clips 2x", "Clear the timeline"];
    return `<section class="workspace agent-workspace"><div class="agent-hero"><span class="eyebrow">AGENT / PROVIDER CONTRACT</span><h1>Intent becomes inspectable operations.</h1><p>The active provider is local and deterministic. Frontier providers must return the same validated operation format before mutation.</p></div><form id="agent-form" class="command-box"><textarea id="agent-input" rows="3" placeholder="e.g. Add everything to the timeline"></textarea><div class="command-footer"><div class="suggestions">${suggestions.map((item) => `<button type="button" data-command="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join("")}</div><button class="primary-button" type="submit">Plan & apply</button></div></form><div class="activity-list">${activity.slice(0, 20).map((item) => `<article class="activity-card"><div><span class="activity-dot"></span><strong>${escapeHtml(item.title)}</strong></div><p>${escapeHtml(item.detail)}</p>${item.operations.length ? `<code>${escapeHtml(item.operations.join(" · "))}</code>` : ""}</article>`).join("")}</div></section>`;
  }

  function renderAssets() {
    const assets = nodesByKind(graph(), "asset");
    if (!assets.length) return `<div class="library-empty"><strong>No media yet</strong><span>Import image, video or audio to populate the Creative Graph.</span></div>`;
    return assets.map((asset) => `<button class="asset-row ${selectedNode().id === asset.id ? "selected" : ""}" data-select="${asset.id}"><span class="asset-glyph">${mediaGlyph(asset.props.mediaKind)}</span><span class="asset-copy"><strong>${escapeHtml(asset.name)}</strong><small>${escapeHtml(asset.props.mediaKind)} · ${formatBytes(asset.props.size)}</small></span><i class="asset-status ${previewUri(asset) ? "online" : "offline"}"></i></button>`).join("");
  }

  function renderInspectorActions(node) {
    if (node.kind === "asset") return `<div class="inspector-actions"><label class="quiet-button file-button full">${previewUri(node) ? "Replace source" : "Relink source"}<input id="relink-input" type="file" accept="image/*,video/*,audio/*,.svg" /></label>${!["audio", "music"].includes(node.props.mediaKind) ? '<button class="primary-button full" data-canvas-action="add-layer">Add to Canvas</button>' : ""}<button class="quiet-button full" data-insert-selected>Insert at playhead</button></div>`;
    if (["clip", "layer"].includes(node.kind) && node.props.role !== "marker") {
      const effects = effectsForTarget(graph(), node.id);
      const controls = node.kind === "clip" ? `<div class="button-grid"><button data-rate="0.5">0.5×</button><button data-rate="1">1×</button><button data-rate="2">2×</button></div><div class="button-grid"><button data-timeline-action="slip-back">Slip −1s</button><button data-timeline-action="slip-forward">Slip +1s</button><button data-timeline-action="ripple-delete">Delete</button></div>` : `<button class="quiet-button full" data-canvas-action="reset">Reset transform</button><button class="quiet-button full" data-canvas-action="delete">Remove layer</button>`;
      return `<div class="inspector-actions">${controls}<div class="effect-add"><button data-add-effect="brightness">+ Bright</button><button data-add-effect="contrast">+ Contrast</button><button data-add-effect="blur">+ Blur</button></div>${effects.map((effect) => `<button class="effect-row ${effect.props.enabled === false ? "disabled" : ""}" data-toggle-effect="${effect.id}"><span>${escapeHtml(effect.name)}</span><small>${effect.props.enabled === false ? "off" : "on"}</small></button>`).join("")}</div>`;
    }
    return "";
  }

  function renderInspector() {
    const node = selectedNode();
    const transform = ["clip", "layer"].includes(node.kind) ? transformForNode(node) : null;
    const entries = Object.entries(node.props).filter(([key]) => !["uri", "waveform", "transform", "keyframes"].includes(key)).slice(0, 14);
    return `<aside class="inspector"><div class="panel-heading"><span>INSPECTOR</span><small>${escapeHtml(node.kind)}</small></div><div class="inspector-name">${escapeHtml(node.name)}</div><dl><div><dt>ID</dt><dd title="${escapeHtml(node.id)}">${escapeHtml(node.id.slice(0, 18))}…</dd></div>${entries.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(Array.isArray(value) ? `${value.length} samples` : value)}</dd></div>`).join("")}${transform ? `<div><dt>position</dt><dd>${Math.round(transform.x)}, ${Math.round(transform.y)}</dd></div><div><dt>scale</dt><dd>${transform.scaleX.toFixed(2)} × ${transform.scaleY.toFixed(2)}</dd></div><div><dt>rotation</dt><dd>${transform.rotation.toFixed(1)}°</dd></div><div><dt>opacity</dt><dd>${Math.round(transform.opacity * 100)}%</dd></div>` : ""}</dl>${renderInspectorActions(node)}<div class="graph-stats"><span><strong>${Object.keys(graph().nodes).length}</strong> nodes</span><span><strong>${Object.keys(graph().edges).length}</strong> edges</span></div><div class="capabilities"><span>${capabilities.webGpu ? "●" : "○"} WebGPU</span><span>${capabilities.webCodecs ? "●" : "○"} WebCodecs</span><span>${capabilities.audioContext ? "●" : "○"} Audio decode</span></div></aside>`;
  }

  return {
    render({ workspace, persistenceStatus, history, activity, appVersion }) {
      const project = graph().nodes[graph().projectId];
      const main = workspace === "canvas" ? renderCanvas() : workspace === "cut" ? renderCut() : workspace === "motion" ? renderMotion() : renderAgent(activity);
      return `<div class="shell"><header class="topbar"><div class="brand"><span class="brand-mark">M</span><strong>MEDIA</strong><span class="alpha">0.3</span></div><div class="project-title">${escapeHtml(project.name)}</div><div class="top-actions"><button id="undo" class="icon-button" ${history.past.length ? "" : "disabled"}>↶</button><button id="redo" class="icon-button" ${history.future.length ? "" : "disabled"}>↷</button><button id="export" class="quiet-button">Export project</button><label class="quiet-button file-button">Open project<input id="project-input" type="file" accept=".media.json,application/json" /></label><label class="primary-button file-button">Import media<input id="file-input" type="file" multiple accept="image/*,video/*,audio/*,.svg" /></label></div></header><div class="body-grid"><aside class="left-panel"><nav class="workspace-nav">${[["canvas", "◫", "Canvas"], ["cut", "▤", "Cut"], ["motion", "◆", "Motion"], ["agent", "✦", "Agent"]].map(([id, icon, name]) => `<button data-workspace="${id}" class="${workspace === id ? "active" : ""}"><span>${icon}</span>${name}</button>`).join("")}</nav><div class="library"><div class="panel-heading"><span>LIBRARY</span><small>${nodesByKind(graph(), "asset").length}</small></div><div class="asset-list">${renderAssets()}</div></div></aside><main class="main-panel">${main}</main>${renderInspector()}</div><footer class="statusbar"><span><i></i>${escapeHtml(persistenceStatus)}</span><span>Graph v${graph().version}</span><span>${history.past.length} edits</span><span>Media ${appVersion}</span></footer></div>`;
    },
  };
}
