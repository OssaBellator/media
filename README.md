# Media

Media is an experimental unified creative workstation for image, video, audio, animation and emerging media.

The architectural thesis remains: **the creative project is the product, not a collection of application-specific files**. Canvas, Cut, Motion, Deliver and Agent are views over one Universal Creative Graph, reversible history and a shared media-kernel contract.

## Current milestone — 0.9

0.9 turns the 0.8 browser reference pipeline into a substantially more bounded and resumable media engine. The focus is source IO, composition playback, streaming derivatives, checkpointed delivery and measurable fidelity/performance contracts.

### Range-addressable source IO

- generic async `size/read(offset,length)` source contract;
- memory, Blob and HTTP Range adapters;
- bounded paged source cache with in-flight deduplication and read statistics;
- exact encoded-window compaction from source ranges;
- sparse classic MP4/MOV indexing that reads `ftyp`/`moov` and top-level headers without materializing `mdat`;
- sparse WebM indexing that reads Info/Tracks, Cluster headers and block/lacing prefixes while skipping frame payloads;
- bounded explicit fallback for fragmented MP4 sources that cannot yet use a sparse `moof` index.

### Composition-aware Cut playback

- Cut playback consumes `evaluateComposition()` instead of manually selecting one top clip;
- all active source-backed clips/layers, transforms and supported effects share the same evaluation semantics as Deliver;
- stale asynchronous decodes are discarded with latest-generation commit semantics;
- preview plans are scaled to bounded dimensions/pixel counts;
- video frames come from Worker/WebCodecs range-backed decode, while image/vector sources retain the bitmap fallback;
- multi-layer normal-blend source plans can render through WebGPU; intrinsic text/shapes and unsupported plans fall back to Canvas2D.

### Streaming derivatives

- resumable proxy jobs still checkpoint keyframe-aligned segments;
- segment source bytes are fetched through range IO;
- decoder output is resized and handed directly to the encoder instead of retained in a decoded-frame array;
- encoded data is retained only for the bounded segment being muxed;
- the previous full-source and decoded-frame batch paths remain compatibility fallbacks, not the preferred Studio path.

### Resumable delivery

- final MP4 rendering can checkpoint fixed frame chunks into derived storage;
- each chunk renders picture and its audio concurrently and uses global output-relative timestamps;
- completed fMP4 media segments survive interruption and are skipped on resume;
- explicit cancellation releases the active chunk without consuming a retry;
- assembly writes one init segment plus ordered media segments and produces a deterministic byte/time fragment index;
- resumable caches can be cleared explicitly and browser quota pressure is surfaced.

### Streaming WebM

The forward streaming writer now records keyframe cluster positions and appends a terminal Cues table. Cluster timing also honors non-default WebM `TimecodeScale` values instead of assuming one millisecond ticks.

### GPU and color fidelity

- source-backed layers share crop/anchor/position/scale/rotation/opacity semantics with Canvas2D;
- common scalar effects run per layer in WGSL and normal alpha blending composes multiple layers;
- GPU and Canvas preview surfaces are separate so fallback remains valid after GPU initialization;
- SDR primary/transfer conversion has a deterministic core contract;
- PQ/HLG frames are rejected from the default 8-bit GPU cache unless an explicit tone-map policy exists, preventing silent HDR clamping;
- GPU textures remain raw numeric storage; color policy is explicit at browser external-image boundaries.

### Conformance/performance hooks

- source read amplification;
- frame-cache hit ratio;
- stale/dropped frame ratios;
- chunk byte-range and decode-time validation;
- render-chunk continuity validation;
- configurable pass/fail budgets for focused regression/performance fixtures.

## Deliberate 0.9 boundaries

This is still a browser reference engine. Sparse fragmented-MP4 `moof` indexing remains outstanding; WebM unknown-size live Clusters are not yet a production live-stream demux path; audio source decode still relies on browser `AudioContext` for compressed local assets; GPU composition currently supports source-backed normal-blend layers rather than every text/vector/blend/mask operation; HDR metadata is preserved but there is no complete scene/display-referred tone-map pipeline; resumable final delivery targets fMP4 rather than rebuilding a fast-start classic MP4 without a final rewrite step.

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

## Engineering principle

The UI is not the source of truth. Gestures, agent plans, Workers, range sources, derivative jobs, render checkpoints and future native frontends converge on the same graph/evaluation/kernel contracts.

See `docs/ARCHITECTURE.md`, `docs/ENGINE.md`, `docs/KERNEL.md`, `docs/SOURCE_IO.md`, `docs/PLAYBACK.md`, `docs/EXPORT.md`, `docs/RENDER_JOBS.md`, `docs/GPU.md`, `docs/AUDIO.md`, `docs/CONFORMANCE.md`, `docs/PROJECT_FORMAT.md`, `docs/DECISIONS.md` and `docs/ROADMAP.md`.
