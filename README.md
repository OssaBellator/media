# Media

Media is an experimental unified creative workstation for image, video, audio, animation and emerging media.

The architectural thesis remains: **the creative project is the product, not a collection of application-specific files**. Canvas, Cut, Motion, Deliver and Agent are views over one Universal Creative Graph, reversible history and a shared media-kernel contract.

## Current milestone — 0.10

0.10 closes the production boundaries left after the bounded/resumable 0.9 engine.

### Sparse and live container IO

- classic MP4/MOV and common WebM remain range-indexed;
- fragmented MP4 now has a sparse `moov` + `moof` index for the common CMAF/default-base-is-moof path, leaving `mdat` unread until sample fetch;
- ambiguous/unsupported fragment layouts retain the explicit bounded compatibility fallback;
- `LiveWebmClusterIndexer` incrementally indexes append-only unknown-size Clusters, waits on partial trailing blocks and does not emit completed frames twice.

### Range-driven compressed audio

Deliver can derive source-time ranges from the audio mix plan, range-index AAC/Opus sources, compact only the required encoded chunks, decode through WebCodecs and copy `AudioData` directly into sparse `f32-planar` PCM blocks. The existing whole-Blob `AudioContext.decodeAudioData()` path is compatibility fallback rather than the preferred compressed-source render path.

### GPU render graph + HDR working space

- evaluated plans now carry blend/mask/transition state;
- the WebGPU reference graph accepts source layers plus rasterized text/shapes;
- alpha masks, crossfade/wipe/dip transitions and normal/multiply/screen/overlay/add/darken/lighten composition are represented explicitly;
- intermediate composition uses `rgba16float` ping-pong targets;
- PQ/HLG transfer helpers and explicit ACES/Reinhard/Hable/clip tone-map policies live in core;
- HDR upload remains capability-gated: the engine does not claim an 8-bit browser upload is scene-linear HDR.

### Resumable render → classic MP4

Completed fMP4 render checkpoints can be exposed as one virtual range source, re-indexed without first concatenating input parts, and finalized into a normal fast-start/classic MP4. The reference final rewrite is currently in-memory and guarded by a payload cap.

### Codec portability

Kernel codec tasks route through a ranked backend registry. Browser WebCodecs is built in; desktop/native and WASM codecs can be injected through the same decode/encode contract. Only explicit `ERR_CODEC_UNSUPPORTED` results fall through automatically.

### Conformance corpus

`npm run conformance` runs the bundled deterministic fixture and any optional real-media corpus present under `MEDIA_CORPUS_DIR`. The manifest covers camera, screen-recording, CMAF/live-stream and audio-only categories with metadata and performance budgets. Missing optional fixtures are skips, not passes.

## Deliberate 0.10 boundaries

This is still a browser reference engine, not a claim of full shipping NLE conformance. Sparse fMP4 focuses on common fragment addressing; exotic base-data-offset/sample-group/encryption layouts need broader coverage. Live WebM is an append-aware indexer, not a network transport. GPU masks are currently alpha/non-feathered and some complex effects still fall back. Browser HDR source ingestion cannot be assumed scene-linear; explicit/native upload adapters remain the path to guaranteed HDR fidelity. Classic MP4 finalization currently rewrites in memory. Native/WASM codec implementations and large real-camera fixtures are integration points, not bundled binaries.

## Run locally

```sh
npm run dev
npm test
npm run syntax:check
npm run build
npm run check
npm run conformance
```

Set `MEDIA_CORPUS_DIR=/path/to/media-corpus` to run optional real-media fixtures.

## Engineering principle

The UI is not the source of truth. Gestures, agents, Workers, range sources, codec backends, GPU passes, derivative jobs and resumable render checkpoints converge on the same graph/evaluation/kernel contracts.

See `docs/ARCHITECTURE.md`, `docs/ENGINE.md`, `docs/KERNEL.md`, `docs/SOURCE_IO.md`, `docs/PLAYBACK.md`, `docs/EXPORT.md`, `docs/GPU.md`, `docs/AUDIO.md`, `docs/CODECS.md`, `docs/CONFORMANCE.md`, `docs/PROJECT_FORMAT.md`, `docs/DECISIONS.md` and `docs/ROADMAP.md`.
