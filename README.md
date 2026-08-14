# Media

Media is an experimental unified creative workstation for image, video, audio, animation and emerging media.

The architectural thesis is simple: **the creative project is the product, not a collection of application-specific files**. Canvas, Cut, Motion, Deliver and Agent are views over the same Universal Creative Graph, shared source media and reversible edit history.

## Current milestone — 0.4

The repository contains a dependency-light browser Studio and a framework-independent semantic/media engine.

### Universal Creative Graph

- projects, assets, compositions, tracks, clips, layers, effects and outputs;
- structural validation plus semantic project invariants;
- atomic operation preflight with indexed diagnostics;
- undo/redo above the mutation boundary;
- `.media.json` file format v2 with formal source manifests and v0/v1 migration;
- stable source identity independent of browser object URLs and machine paths.

### Canvas

- shared image/video/vector source layers;
- first-class editable text layers;
- first-class vector rectangle/ellipse layers;
- position, scale, rotation, opacity, anchors and crop;
- drag editing;
- keyframe-compatible transforms;
- nondestructive effect stacks;
- Canvas2D still renderer with feature-detected WebGPU surface bootstrap.

### Cut

- multi-track visual/audio timeline;
- frame-based transport and click-to-seek;
- draggable clips with edit-point/marker snapping;
- move, trim, split, slip, duplicate, roll edit, blade-all and ripple edits;
- ripple insert at the playhead;
- playback-rate changes preserving source range;
- track mute/lock state with edit-time lock enforcement;
- waveform display;
- clip gain, pan, fades and browser AudioContext scheduling.

### Motion

- numeric keyframes on shared layer/clip properties;
- linear, hold, ease-in, ease-out and ease-in-out interpolation;
- keyframe lanes tied to the same transport as Cut;
- animated transforms flow into composition evaluation rather than flattening output.

### Deliver

- output nodes live in the Creative Graph;
- source-master, vertical, square, web, image-sequence and render-plan presets;
- deterministic render manifests/signatures;
- explicit source dependencies;
- frame enumeration and audio-plan summaries;
- current-frame PNG rendering through the same composition evaluation plan.

### Media/runtime foundations

- image/video/audio metadata probing;
- sampled SHA-256 source fingerprints;
- source-manifest matching and fingerprint relinking;
- IndexedDB source persistence and derived-artifact store;
- weighted LRU decoded-frame cache;
- priority/deduplicating decode scheduler;
- audio waveform extraction;
- browser frame provider and video-frame fallback;
- browser audio mixer;
- WebGPU capability/compositor bootstrap with Canvas2D fallback.

### Agent boundary

The local planner is deliberately deterministic, but the provider interface is replaceable:

```text
intent
  -> provider (local or HTTP)
  -> sanitized project snapshot
  -> validated operations
  -> atomic preflight
  -> semantic invariants
  -> project graph
```

Remote providers do not receive local source URIs or waveform arrays and do not receive privileged mutation access.

## Run locally

Requires Node.js 22+.

```bash
npm run dev
```

Open `http://127.0.0.1:4173`.

There are currently no runtime package dependencies and no install step is required for the prototype.

## Validate locally

GitHub Actions is intentionally not used. The repository-owned gate is:

```bash
npm run check
```

It runs syntax checks, the Node test suite and the static build. The 0.4 milestone contains **69 local tests**.

Useful commands:

```bash
npm run syntax:check
npm test
npm run test:watch
npm run build
```

## Keyboard controls

In Cut or Motion:

- `Space` — play/pause
- `Left` / `Right` — previous/next frame
- `M` — add a marker at the playhead
- `S` — split selected clip at playhead
- `B` — blade all unlocked clips intersecting the playhead
- `Cmd/Ctrl+Z` — undo
- `Cmd/Ctrl+Shift+Z` — redo

## Repository layout

```text
apps/studio/             Browser Studio and browser runtime adapters
apps/studio/test/        Runtime-module tests runnable in Node
packages/core/src/       Creative Graph, editing, evaluation, audio/deliver/cache semantics
packages/core/test/      Core unit/integration tests
scripts/                 Dependency-free dev/build/check tooling
docs/                    Architecture, engine contracts, project format, decisions, roadmap
```

## Engineering principle

The UI is not the source of truth. Mouse gestures, keyboard shortcuts, agent plans, future plugins, collaboration and native frontends should converge on the same operation/evaluation contracts.

See `docs/ARCHITECTURE.md`, `docs/ENGINE.md`, `docs/PROJECT_FORMAT.md`, `docs/DECISIONS.md` and `docs/ROADMAP.md`.
