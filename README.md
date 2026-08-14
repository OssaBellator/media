# Media

Media is an experimental unified creative workstation for image, video, audio, animation and emerging media.

The architectural thesis is simple: **the creative project is the product, not a collection of application-specific files**. Canvas, Cut, Motion, Deliver and Agent are views over the same Universal Creative Graph, reversible history and one media-kernel contract.

## Current milestone — 0.8

0.8 integrates the production-media kernel back into editing and delivery. It deliberately works all ten boundaries left open after 0.7 rather than adding another workspace.

### Cut playback and streaming decode

- Cut has a Worker-pool/WebCodecs playback service with HTML media retained as fallback only;
- active video clips are resolved from the timeline clock and Creative Graph, including source-time/playback-rate mapping;
- keyframe-safe decode windows are compacted to only the encoded bytes a Worker needs;
- decoded `VideoFrame`s can be transferred in kernel progress events as they arrive rather than retained until task completion;
- the editor keeps a bounded decoded-frame cache and invalidates it when a source fingerprint changes.

### Resumable derivatives

- proxy jobs are split into keyframe-aligned segments;
- segment state, attempts and artifacts are persisted through the existing IndexedDB derived store;
- completed segments survive interruption and are skipped on resume;
- each segment compacts its encoded video window before transcode;
- browser proxy transcode remains bounded and emits VP9/AV1 + optional Opus WebM artifacts.

### Deliver and streaming output

- Deliver can render the evaluated timeline frame-by-frame into WebCodecs encoders and mux MP4 or WebM;
- an offline PCM mix can be encoded alongside picture;
- explicit streaming export can write fMP4 or unknown-size WebM directly to a byte/File-System sink;
- progressive streaming mode does not retain the complete encoded video stream before muxing;
- the existing in-memory fast-start MP4/WebM paths remain available for smaller exports.

### MP4 presentation fidelity

- classic and fragmented MP4 writers accept AVC, HEVC and AV1 video sample entries where a valid decoder description is available;
- `colr/nclx`, `pasp`, `clli`, `mdcv` and track rotation matrices can be emitted;
- the encoded-stream bridge preserves color, HDR, pixel-aspect and rotation metadata;
- demux-side parsers surface those presentation properties again on imported video tracks.

### WebGPU effects

- decoded frames can be copied into persistent, byte-bounded LRU `GPUTexture`s;
- a WGSL compositor applies brightness, contrast, saturation, hue, opacity and an approximate blur in one shader pass;
- Canvas2D remains the fallback;
- Cut's kernel playback surface uses this compositor when WebGPU is available.

### Offline audio automation and loudness

- sample-domain gain/pan automation curves with linear/hold/eased interpolation;
- graph operation helpers for clip and output automation;
- automated offline mix rendering with source-rate conversion, playback rate, fades and master gain;
- BS.1770-style K-weighted integrated loudness with absolute/relative gating and surround channel weighting;
- windowed-sinc 4× intersample peak estimation and target-LUFS/peak-constrained normalization;
- Deliver exposes loudness analysis and can apply configured output loudness targets during offline render.

## Deliberate 0.8 boundaries

This is still a browser reference engine, not a claim of finished NLE playback/export. Worker Cut playback currently presents the top active video clip rather than GPU-compositing every overlapping timeline layer. Proxy transcode is resumable by bounded segment, but each segment still batch-decodes internally. Progressive export prepares audio before the video stream, WebM streaming omits a final Cue table, HDR metadata is structural rather than a complete color-management pipeline, and the loudness/true-peak implementation is an engineering reference rather than a certified broadcast meter.

## Run locally

Requires Node.js 22+.

```bash
npm run dev
```

Open `http://127.0.0.1:4173`.

There are no runtime package dependencies and no install step is required for the prototype.

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
apps/studio/             Browser Studio plus playback/GPU/codec/delivery runtimes
apps/studio/test/        Runtime-module tests runnable in Node with injected fakes
packages/core/src/       Creative semantics + container/audio/streaming primitives
packages/core/test/      Core unit/integration tests
scripts/                 Dependency-free dev/build/check tooling
docs/                    Architecture, kernel, export, playback, GPU and audio contracts
```

## Engineering principle

The UI is not the source of truth. Mouse gestures, keyboard shortcuts, agent plans, Workers, derived-media jobs, render sinks and future native frontends should converge on the same operation/evaluation/kernel contracts.

See `docs/ARCHITECTURE.md`, `docs/ENGINE.md`, `docs/KERNEL.md`, `docs/EXPORT.md`, `docs/PLAYBACK.md`, `docs/GPU.md`, `docs/AUDIO.md`, `docs/PROJECT_FORMAT.md`, `docs/DECISIONS.md` and `docs/ROADMAP.md`.
