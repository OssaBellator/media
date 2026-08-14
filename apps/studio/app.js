import {
  addAsset,
  applyOperations,
  childrenOf,
  commit,
  createAsset,
  createHistory,
  createMediaProject,
  nodesByKind,
  planIntent,
  redo,
  serializeProject,
  undo,
} from "/packages/core/src/index.js";

const app = document.querySelector("#app");
let history = createHistory(createMediaProject("Untitled project"));
let workspace = "canvas";
let selectedId = history.present.projectId;
let activity = [
  {
    title: "Project created",
    detail: "Universal Creative Graph ready for image, video and audio assets.",
    operations: [],
  },
];

const graph = () => history.present;
const selectedNode = () => graph().nodes[selectedId] ?? graph().nodes[graph().projectId];
const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

function mediaGlyph(kind) {
  return { image: "◫", video: "▶", audio: "≋", music: "♪", vector: "◇", unknown: "·" }[kind] ?? "·";
}

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function renderPreview(node) {
  if (!node || node.kind !== "asset") {
    const composition = nodesByKind(graph(), "composition")[0];
    return `
      <div class="composition-frame" style="aspect-ratio:${composition?.props.width ?? 16}/${composition?.props.height ?? 9}">
        <div class="empty-stage">
          <div class="stage-mark">M</div>
          <h2>One project, every medium.</h2>
          <p>Import image, video or audio. The same asset can then appear in Canvas, Cut and future workspaces without duplicate project files.</p>
        </div>
      </div>`;
  }
  const uri = escapeHtml(node.props.uri);
  const label = escapeHtml(node.name);
  if (node.props.mediaKind === "image") {
    return `<div class="composition-frame media-frame"><img src="${uri}" alt="${label}" /></div>`;
  }
  if (node.props.mediaKind === "video") {
    return `<div class="composition-frame media-frame"><video src="${uri}" controls playsinline></video></div>`;
  }
  if (node.props.mediaKind === "audio") {
    return `<div class="composition-frame audio-frame"><div class="audio-art">≋</div><h2>${label}</h2><audio src="${uri}" controls></audio></div>`;
  }
  return `<div class="composition-frame"><div class="empty-stage"><h2>${label}</h2><p>Preview support for this media kind is not implemented yet.</p></div></div>`;
}

function renderCanvas() {
  return `
    <section class="workspace canvas-workspace">
      <div class="workspace-toolbar">
        <span class="eyebrow">CANVAS</span>
        <span class="toolbar-copy">Spatial view of the selected creative object</span>
      </div>
      <div class="stage-wrap">${renderPreview(selectedNode())}</div>
    </section>`;
}

function renderTimeline() {
  const composition = nodesByKind(graph(), "composition")[0];
  const tracks = nodesByKind(graph(), "track").sort((a, b) => a.props.order - b.props.order);
  const clips = nodesByKind(graph(), "clip");
  const duration = Number(composition?.props.duration ?? 30);
  const ruler = Array.from({ length: 7 }, (_, index) => {
    const seconds = Math.round((duration / 6) * index);
    return `<span style="left:${(index / 6) * 100}%">${seconds}s</span>`;
  }).join("");

  return `
    <div class="timeline-shell">
      <div class="ruler">${ruler}</div>
      ${tracks
        .map((track) => {
          const trackClips = clips.filter((clip) => clip.props.trackId === track.id);
          return `<div class="track-row">
            <div class="track-label"><strong>${escapeHtml(track.name)}</strong><span>${escapeHtml(track.props.mediaKind)}</span></div>
            <div class="track-lane">
              ${trackClips
                .map((clip) => {
                  const left = Math.min(100, (Number(clip.props.start ?? 0) / duration) * 100);
                  const width = Math.max(4, Math.min(100 - left, (Number(clip.props.duration ?? 1) / duration) * 100));
                  const asset = graph().nodes[clip.props.assetId];
                  return `<button class="clip ${clip.id === selectedId ? "selected" : ""}" data-select="${clip.id}" style="left:${left}%;width:${width}%">
                    <span>${mediaGlyph(asset?.props.mediaKind)}</span>${escapeHtml(clip.name)}
                  </button>`;
                })
                .join("")}
              ${trackClips.length === 0 ? '<span class="track-empty">Use “Add everything to timeline” in Agent</span>' : ""}
            </div>
          </div>`;
        })
        .join("")}
    </div>`;
}

function renderCut() {
  return `
    <section class="workspace cut-workspace">
      <div class="workspace-toolbar">
        <span class="eyebrow">CUT</span>
        <span class="toolbar-copy">Temporal view of the same graph</span>
      </div>
      <div class="cut-preview">${renderPreview(selectedNode())}</div>
      ${renderTimeline()}
    </section>`;
}

function renderAgent() {
  const suggestions = [
    "Add everything to the timeline",
    "Make it vertical 9:16",
    "Rename project to Product launch",
    "Clear the timeline",
  ];
  return `
    <section class="workspace agent-workspace">
      <div class="agent-hero">
        <span class="eyebrow">AGENT / LOCAL PLANNER</span>
        <h1>Describe an edit. Inspect the operations.</h1>
        <p>This prototype deliberately separates intent from mutation. Today a deterministic planner handles a small command set; later, model providers can produce the same validated operation format.</p>
      </div>
      <form id="agent-form" class="command-box">
        <textarea id="agent-input" rows="3" placeholder="e.g. Add everything to the timeline"></textarea>
        <div class="command-footer">
          <div class="suggestions">${suggestions.map((item) => `<button type="button" data-command="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join("")}</div>
          <button class="primary-button" type="submit">Plan & apply</button>
        </div>
      </form>
      <div class="activity-list">
        ${activity
          .map(
            (item) => `<article class="activity-card">
              <div><span class="activity-dot"></span><strong>${escapeHtml(item.title)}</strong></div>
              <p>${escapeHtml(item.detail)}</p>
              ${item.operations.length ? `<code>${escapeHtml(item.operations.join("  ·  "))}</code>` : ""}
            </article>`,
          )
          .join("")}
      </div>
    </section>`;
}

function renderAssets() {
  const assets = nodesByKind(graph(), "asset");
  if (!assets.length) {
    return `<div class="library-empty"><strong>No media yet</strong><span>Import local files to populate the creative graph.</span></div>`;
  }
  return assets
    .map(
      (asset) => `<button class="asset-row ${selectedId === asset.id ? "selected" : ""}" data-select="${asset.id}">
        <span class="asset-glyph">${mediaGlyph(asset.props.mediaKind)}</span>
        <span class="asset-copy"><strong>${escapeHtml(asset.name)}</strong><small>${escapeHtml(asset.props.mediaKind)} · ${formatBytes(asset.props.size)}</small></span>
      </button>`,
    )
    .join("");
}

function renderInspector() {
  const node = selectedNode();
  return `
    <aside class="inspector">
      <div class="panel-heading"><span>INSPECTOR</span><small>${escapeHtml(node.kind)}</small></div>
      <div class="inspector-name">${escapeHtml(node.name)}</div>
      <dl>
        <div><dt>ID</dt><dd title="${escapeHtml(node.id)}">${escapeHtml(node.id.slice(0, 18))}…</dd></div>
        ${Object.entries(node.props)
          .filter(([key]) => key !== "uri")
          .slice(0, 10)
          .map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`)
          .join("")}
      </dl>
      <div class="graph-stats">
        <span><strong>${Object.keys(graph().nodes).length}</strong> nodes</span>
        <span><strong>${Object.keys(graph().edges).length}</strong> edges</span>
      </div>
    </aside>`;
}

function render() {
  const project = graph().nodes[graph().projectId];
  app.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="brand"><span class="brand-mark">M</span><strong>MEDIA</strong><span class="alpha">ALPHA</span></div>
        <div class="project-title">${escapeHtml(project.name)}</div>
        <div class="top-actions">
          <button id="undo" class="icon-button" ${history.past.length ? "" : "disabled"} title="Undo">↶</button>
          <button id="redo" class="icon-button" ${history.future.length ? "" : "disabled"} title="Redo">↷</button>
          <button id="export" class="quiet-button">Export project</button>
          <label class="primary-button file-button">Import media<input id="file-input" type="file" multiple accept="image/*,video/*,audio/*,.svg" /></label>
        </div>
      </header>
      <div class="body-grid">
        <aside class="left-panel">
          <nav class="workspace-nav">
            ${[
              ["canvas", "◫", "Canvas"],
              ["cut", "▤", "Cut"],
              ["agent", "✦", "Agent"],
            ]
              .map(([id, icon, name]) => `<button data-workspace="${id}" class="${workspace === id ? "active" : ""}"><span>${icon}</span>${name}</button>`)
              .join("")}
          </nav>
          <div class="library">
            <div class="panel-heading"><span>LIBRARY</span><small>${nodesByKind(graph(), "asset").length}</small></div>
            <div class="asset-list">${renderAssets()}</div>
          </div>
        </aside>
        <main class="main-panel">${workspace === "canvas" ? renderCanvas() : workspace === "cut" ? renderCut() : renderAgent()}</main>
        ${renderInspector()}
      </div>
      <footer class="statusbar">
        <span><i></i> Local-first prototype</span>
        <span>Graph v${graph().version}</span>
        <span>${history.past.length} edits</span>
      </footer>
    </div>`;
  bindEvents();
}

function bindEvents() {
  document.querySelectorAll("[data-workspace]").forEach((button) =>
    button.addEventListener("click", () => {
      workspace = button.dataset.workspace;
      render();
    }),
  );
  document.querySelectorAll("[data-select]").forEach((button) =>
    button.addEventListener("click", () => {
      selectedId = button.dataset.select;
      render();
    }),
  );
  document.querySelector("#file-input")?.addEventListener("change", importFiles);
  document.querySelector("#export")?.addEventListener("click", exportProject);
  document.querySelector("#undo")?.addEventListener("click", () => {
    history = undo(history);
    selectedId = graph().nodes[selectedId] ? selectedId : graph().projectId;
    render();
  });
  document.querySelector("#redo")?.addEventListener("click", () => {
    history = redo(history);
    render();
  });
  document.querySelector("#agent-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.querySelector("#agent-input");
    executeIntent(input.value);
  });
  document.querySelectorAll("[data-command]").forEach((button) =>
    button.addEventListener("click", () => executeIntent(button.dataset.command)),
  );
}

function importFiles(event) {
  const files = [...event.target.files];
  if (!files.length) return;
  let next = graph();
  for (const file of files) {
    const uri = URL.createObjectURL(file);
    next = addAsset(next, createAsset({ name: file.name, mimeType: file.type, size: file.size, uri }));
  }
  history = commit(history, next, `Import ${files.length} media file${files.length === 1 ? "" : "s"}`);
  const newestAsset = nodesByKind(graph(), "asset").at(-1);
  if (newestAsset) selectedId = newestAsset.id;
  activity.unshift({ title: "Media imported", detail: `${files.length} asset${files.length === 1 ? "" : "s"} added to the project graph.`, operations: ["node.add", "edge.add"] });
  render();
}

function executeIntent(intent) {
  if (!intent?.trim()) return;
  const lower = intent.trim().toLowerCase();
  if (lower === "undo") {
    history = undo(history);
    render();
    return;
  }
  if (lower === "redo") {
    history = redo(history);
    render();
    return;
  }
  const plan = planIntent(graph(), intent);
  if (plan.operations.length) {
    const next = applyOperations(graph(), plan.operations);
    history = commit(history, next, plan.summary);
  }
  activity.unshift({ title: intent, detail: plan.summary, operations: plan.operations.map((operation) => operation.type) });
  render();
}

function exportProject() {
  const portable = structuredClone(graph());
  for (const asset of nodesByKind(portable, "asset")) {
    if (String(asset.props.uri).startsWith("blob:")) asset.props.uri = "";
  }
  const blob = new Blob([serializeProject(portable)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${portable.nodes[portable.projectId].name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "project"}.media.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

document.addEventListener("keydown", (event) => {
  const modifier = event.metaKey || event.ctrlKey;
  if (!modifier || event.key.toLowerCase() !== "z") return;
  event.preventDefault();
  history = event.shiftKey ? redo(history) : undo(history);
  render();
});

render();
