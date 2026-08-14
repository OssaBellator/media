# Media

Media is an experimental unified creative workstation for image, video, audio, animation and emerging media.

The architectural thesis is simple: **the creative project is the product, not a collection of application-specific files**. Canvas, Cut, Motion, Deliver and Agent are views over the same Universal Creative Graph, shared source media, reversible history and one media-kernel contract.

## Current milestone — 0.7

0.7 closes the first practical browser export/derivative loops on top of the 0.6 demux + WebCodecs kernel.

### Editor foundation

The existing creative layer remains intact: Universal Creative Graph, Canvas, multi-track Cut, Motion keyframes/effects, audio editing, Deliver manifests/stills, Agent provider boundaries, IndexedDB projects/media/derived artifacts and resumable render jobs.

### Container and export paths

- classic fast-start MP4/MOV writer for AVC (`avc1`/`avc3`) + AAC (`mp4a.40.*`);
- `stsd`, `stts`, signed/unsigned `ctts`, `stsc`, `stsz`, `stco`/`co64`, `stss`, `avcC` and `esds` output;
- leading non-zero classic track time is represented with `edts/elst` rather than silently discarded;
- long media durations promote `mdhd` to version 1 when 32-bit microsecond duration is insufficient;
- fragmented MP4 init output with `mvex/trex` plus `moof/traf/tfhd/tfdt/trun` media segments;
- existing WebM VP8/VP9/AV1 + Opus/Vorbis writer and WAV PCM/float writer;
- WebCodecs encoder results can be converted directly into mux plans while preserving decoder descriptions.

### Import timing

- MP4 `elst` v0/v1 parsing;
- leading empty edits and 1× trim/remap semantics;
- simple edit lists are applied to demuxed chunk timing;
- unsupported rate-changing edits remain visible in demux metadata instead of making the source unreadable.

### Derived media

- keyframe-safe thumbnail decode from normalized chunk indexes;
- OffscreenCanvas/Canvas2D thumbnail encoding to WebP/PNG/etc.;
- executable WebM proxy transcode: demuxed chunks → WebCodecs decode → resize → WebCodecs encode → Media WebM mux;
- optional audio transcode to Opus for editorial proxies;
- explicit decoded-frame caps so large sources must be segmented instead of retaining unbounded `VideoFrame`/`AudioData` batches;
- kernel `thumbnail` and `proxy` tasks now have real runtime implementations.

### Scheduling correctness

A decode-window boundary bug was fixed: a chunk whose end time equals the selected keyframe is no longer included before that keyframe. This prevents unnecessary pre-keyframe delta data from entering decode windows.

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
- `M` — marker at playhead
- `S` — split selected clip at playhead
- `B` — blade unlocked clips at playhead
- `Cmd/Ctrl+Z` — undo
- `Cmd/Ctrl+Shift+Z` — redo

## Repository layout

```text
apps/studio/             Browser Studio and browser/runtime/kernel adapters
apps/studio/test/        Runtime-module tests runnable in Node
packages/core/src/       Creative semantics + container/kernel/export primitives
packages/core/test/      Core unit/integration tests
scripts/                 Dependency-free dev/build/check tooling
docs/                    Architecture, engine/kernel/export contracts and roadmap
```

## Engineering principle

The UI is not the source of truth. Mouse gestures, keyboard shortcuts, agent plans, collaboration, derived-media workers and future native frontends should converge on the same operation/evaluation/kernel contracts.

See `docs/ARCHITECTURE.md`, `docs/ENGINE.md`, `docs/KERNEL.md`, `docs/EXPORT.md`, `docs/PROJECT_FORMAT.md`, `docs/DECISIONS.md` and `docs/ROADMAP.md`.
