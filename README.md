# Media

Media is an experimental unified creative workstation for image, video, audio, animation and emerging media.

The architectural thesis is simple: **the creative project is the product, not a collection of application-specific files**. Canvas, Cut, Motion and Agent operate on the same Universal Creative Graph, the same assets and the same reversible edit history.

## Current milestone — 0.3

This repository now contains a dependency-light browser Studio plus a framework-independent core engine.

### Universal Creative Graph

- projects, assets, compositions, tracks, clips, layers, effects and outputs;
- explicit containment/reference/target relationships;
- structural validation plus semantic project invariants;
- atomic, preflighted operation batches with failure diagnostics;
- history/undo/redo above the mutation boundary;
- versioned `.media.json` project files with legacy bare-graph migration.

### Canvas

- shared visual assets can be placed as nondestructive Canvas layers;
- drag positioning plus scale, rotation and opacity controls;
- reusable transform model including anchors and crop values;
- nondestructive brightness/contrast/blur effect stacks;
- feature-detected WebGPU compositor surface with Canvas2D fallback.

### Cut

- multi-track timeline;
- frame-based transport/playhead;
- click-to-seek and keyboard transport;
- draggable clips with edit-point snapping;
- trim, split, slip and ripple delete;
- ripple insert at the playhead;
- playback-rate changes that preserve source range;
- track mute/lock state and lock enforcement;
- marker snapping;
- audio waveform display where browser decoding is available.

### Motion

- numeric keyframes on shared layer/clip properties;
- linear, hold and eased interpolation primitives;
- keyframe lanes tied to the same transport as Cut;
- animated transform evaluation in the composition engine;
- effect stacks and animation are included in render-plan evaluation rather than flattened output.

### Media/persistence

- browser metadata probing for image/video/audio;
- sampled SHA-256 source fingerprints;
- audio waveform extraction;
- IndexedDB project and source-blob persistence;
- stable `media://asset/<id>` source locators;
- relink/replace-source workflow;
- project exports include an asset manifest while keeping media external.

### Agent boundary

The current local planner is deliberately deterministic. The important implementation is the **provider contract**:

`intent -> provider -> validated operations -> semantic invariants -> project graph`

A frontier model can be plugged into that boundary later without receiving an unrestricted mutation channel.

## Run locally

Requires Node.js 22+.

```bash
npm run dev
```

Open `http://127.0.0.1:4173`.

There are currently no runtime package dependencies and no installation step is needed.

## Validate locally

GitHub Actions is intentionally not used. The repository owns its local validation gate:

```bash
npm run check
```

That runs:

```bash
npm run syntax:check
npm test
npm run build
```

The current suite contains 38 core/browser-module tests and uses Node's built-in test runner.

## Keyboard controls

In Cut or Motion:

- `Space` — play/pause
- `Left` / `Right` — previous/next frame
- `M` — add a marker at the playhead
- `S` — split the selected clip at the playhead (Cut)
- `Cmd/Ctrl+Z` — undo
- `Cmd/Ctrl+Shift+Z` — redo

## Repository layout

```text
apps/studio/             Browser Studio and browser media/runtime adapters
apps/studio/test/        Browser-module tests runnable in Node where possible
packages/core/src/       Universal Creative Graph and editing/evaluation engine
packages/core/test/      Core unit/integration tests
scripts/                 Dependency-free dev/build/check tooling
docs/                    Architecture, engine contracts, decisions and roadmap
```

## Engineering principle

The UI is not the source of truth. A mouse drag, keyboard shortcut, agent plan, plugin, collaborative edit or future native frontend should all eventually converge on the same validated operation and evaluation contracts.

See `docs/ARCHITECTURE.md`, `docs/ENGINE.md`, `docs/PROJECT_FORMAT.md`, `docs/DECISIONS.md` and `docs/ROADMAP.md`.
