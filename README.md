# Media

Media is an early implementation of a unified creative workspace for images, video, audio, animation and emerging media.

The project starts from one architectural constraint: **a creative project is the product, not a collection of application-specific files**. Canvas, timeline, audio, motion and agent interfaces should all operate on the same underlying objects and history.

## What exists now

This initial alpha includes:

- a versioned **Universal Creative Graph** for projects, assets, compositions, tracks and clips;
- typed-by-convention graph operations (`node.add`, `node.update`, `edge.add`, etc.) as the mutation boundary;
- undo/redo history above the graph;
- portable `.media.json` serialization;
- a deterministic local intent planner that demonstrates how an AI agent can emit inspectable graph operations;
- a browser studio shell with **Canvas**, **Cut**, **Agent**, Library and Inspector views;
- local import and preview for common image, video and audio files;
- local project export;
- zero runtime dependencies and local test/build scripts.

The current studio is deliberately dependency-light. This lets the data model and interaction thesis evolve before committing the product to a heavyweight UI/runtime architecture.

## Run locally

Requires Node.js 22+.

```bash
npm run dev
```

Open `http://127.0.0.1:4173`.

No package installation is required for the current prototype.

## Validate locally

GitHub Actions is intentionally not used in this repository. Run the complete local gate before committing:

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

1. Import one or more images, videos or audio files.
2. Select an asset in the Library and inspect it in Canvas.
3. Open Agent and run **Add everything to the timeline**.
4. Switch to Cut to see those same asset objects represented as clips.
5. Try **Make it vertical 9:16**, then undo/redo.
6. Export the graph as a `.media.json` project file.

The Agent tab is **not pretending to be a general AI system** yet. Its planner is deterministic and intentionally small. The important implementation is the operation contract between an intent planner and the project graph; model-backed planners can later target that contract.

## Repository layout

```text
apps/studio/          Browser studio shell
packages/core/        Universal Creative Graph, operations, history, planner
packages/core/test/   Node built-in tests
scripts/              Local dev/build/check tooling
docs/                 Architecture, decisions and roadmap
```

## Current principles

- One project graph, many views.
- AI proposes operations; it does not bypass project semantics.
- Every meaningful edit should become reversible and inspectable.
- Local editing must remain useful without AI credits or a network connection.
- Open project data and clean export are product features, not afterthoughts.
- Performance-critical media engines can move to native/WASM/GPU layers without changing the project model.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/ROADMAP.md](docs/ROADMAP.md).
