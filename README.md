# Media

Media is an experimental unified creative workstation for image, video, audio, animation and emerging media.

The architectural thesis is simple: **the creative project is the product, not a collection of application-specific files**. Canvas, Cut, Motion, Deliver and Agent are views over the same Universal Creative Graph, shared source media and reversible edit history.

## Current milestone — 0.5

0.5 begins the production-media-kernel layer underneath the 0.4 creative engine.

### Creative/editor layer

- Universal Creative Graph with semantic invariants and atomic operations;
- Canvas with source, text and native vector layers;
- Cut with multi-track move/trim/split/slip/duplicate/ripple/roll/blade editing;
- Motion keyframes and nondestructive effects;
- audio gain/pan/fades and browser preview mixing;
- Deliver output nodes, deterministic render manifests and local still rendering;
- local and HTTP planner-provider boundaries;
- IndexedDB projects, media sources, derived artifacts and fingerprint relinking.

### Media kernel — 0.5

- versioned kernel task/result/error/progress protocol;
- cancellable kernel handler runtime;
- browser Worker client plus inline fallback;
- container sniffing and normalized demux/track/chunk descriptors;
- real RIFF/WAVE metadata parsing and PCM/float WAV decoding;
- ISO-BMFF box, `ftyp` and movie-header parsing for MP4/MOV structural inspection;
- EBML variable-integer/element parsing and WebM header inspection;
- keyframe-aware seek indexes and directional decode-prefetch windows;
- offline Float32 PCM resampling and gain/pan/fade mixing primitives;
- proxy/thumbnail/waveform derivative planning with deterministic keys;
- mux sample interleaving and keyframe-aligned segment planning;
- resumable chunked render jobs with retry/interruption recovery;
- production render DAG: source verification → derivatives → frame/audio render → encode → mux.

### Deliberate boundary

0.5 does **not** claim full MP4/MOV/WebM demux or encoded video export. MP4/MOV inspection currently parses container boxes/brands/movie timing; WebM inspection parses EBML structure and DocType. Full sample tables/clusters, codec-specific descriptions, WebCodecs encoded-chunk feeding, production encoders and final container writers remain the next kernel work.

WAV is different: uncompressed PCM/IEEE-float WAV parsing and decode are implemented in the core kernel.

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
apps/studio/             Browser Studio and browser/runtime/kernel adapters
apps/studio/test/        Runtime-module tests runnable in Node
packages/core/src/       Creative semantics plus media-kernel contracts/parsers/planners
packages/core/test/      Core unit/integration tests
scripts/                 Dependency-free dev/build/check tooling
docs/                    Architecture, engine/kernel contracts, project format, roadmap
```

## Engineering principle

The UI is not the source of truth. Mouse gestures, keyboard shortcuts, agent plans, future plugins, collaboration and native frontends should converge on the same operation/evaluation/kernel contracts.

See `docs/ARCHITECTURE.md`, `docs/ENGINE.md`, `docs/KERNEL.md`, `docs/PROJECT_FORMAT.md`, `docs/DECISIONS.md` and `docs/ROADMAP.md`.
