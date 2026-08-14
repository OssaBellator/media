# Media

Media is an early implementation of a unified creative workspace for images, video, audio, animation and emerging media.

The architectural constraint is simple: **a creative project is the product, not a collection of application-specific files**. Canvas, timeline, audio, motion and agent interfaces operate on the same underlying objects and history.

## Current alpha

The current implementation includes:

- a versioned **Universal Creative Graph** for projects, assets, compositions, tracks, clips, layers, effects and outputs;
- validated graph operations (`node.add`, `node.update`, `node.remove`, `edge.add`, `edge.remove`) as the mutation boundary;
- named transactional operation batches and undo/redo history;
- a versioned `.media.json` project envelope with support for opening legacy bare-graph files;
- timeline primitives for move, trim, split and ripple delete;
- a deterministic local intent planner that emits the same operations future model-backed agents will use;
- a browser Studio with **Canvas**, **Cut**, **Agent**, Library and Inspector views;
- browser metadata extraction for image dimensions and audio/video duration/dimensions where supported;
- IndexedDB persistence for the current project graph and imported local media blobs;
- project open/export flows and offline-media handling;
- zero runtime dependencies and local test/build scripts.

The UI remains deliberately dependency-light while the project model and editing semantics stabilize. Performance-critical decoding, rendering and effects can later move behind WebCodecs/WebGPU/WASM/native boundaries without changing project semantics.

## Run locally

Requires Node.js 22+.

```bash
npm run dev
```

Open `http://127.0.0.1:4173`.

No package installation is required for the current prototype.

## Validate locally

GitHub Actions is intentionally not used. Run the complete local gate before committing:

```bash
npm run check
```

The gate runs syntax checks, core tests and a static production build. Individual commands:

```bash
npm run syntax:check
npm test
npm run test:watch
npm run build
```

## Try the prototype

1. Import images, videos or audio. Metadata and media blobs are stored locally in the browser.
2. Reload the page to verify the project and locally imported media restore from IndexedDB.
3. Open **Agent** and run **Add everything to the timeline**.
4. Switch to **Cut**, select a clip and use nudge, trim, split or ripple delete.
5. Undo/redo those edits to verify they share the graph history layer.
6. Export the project as `.media.json`, then reopen it with **Open project**.

Portable project files intentionally do not embed local media blobs yet. Exported assets retain their metadata but become offline until a future relink/package workflow is implemented.

## Repository layout

```text
apps/studio/          Browser studio shell and local IndexedDB storage
packages/core/        Universal Creative Graph, operations, timeline, history, planner
packages/core/test/   Node built-in tests
scripts/              Local dev/build/check tooling
docs/                 Architecture, decisions and roadmap
```

## Principles

- One project graph, many views.
- AI proposes validated operations; it does not bypass project semantics.
- Every meaningful edit should be reversible and inspectable.
- Local editing remains useful without AI credits or a network connection.
- Project formats are versioned and migrations are explicit.
- Open project data and clean export are product features, not afterthoughts.
- Media engines may evolve independently behind stable project operations.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/ROADMAP.md](docs/ROADMAP.md).
