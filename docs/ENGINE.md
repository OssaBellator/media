# Media engine contracts

## Execution layers

Media separates creative semantics from media execution so the same project can be evaluated by a browser preview, a future native editor or a render farm.

### Level A — semantic engine (implemented)

Pure JavaScript, DOM-free and locally testable:

- graph structure and semantic invariants;
- atomic operation preflight;
- timeline edits and snapping;
- spatial transforms;
- native text and vector shape layers;
- keyframes and effects;
- frame transport;
- composition evaluation;
- audio timing/mix plans;
- delivery outputs and deterministic render manifests;
- weighted caches and media task scheduling;
- source manifests/relink scoring;
- planner/provider validation.

### Level B — browser runtime adapters (implemented foundation)

- metadata probing;
- sampled source fingerprinting;
- waveform decode/downsampling;
- IndexedDB source + derived-artifact persistence;
- priority/deduplicated browser frame provider;
- HTML media-element video-frame fallback;
- Canvas2D render-plan compositor for images/video/text/shapes;
- AudioContext multi-clip scheduling with gain/pan/fades;
- WebGPU canvas/bootstrap capability path.

### Level C — production media kernels (next)

Still required for a professional high-throughput editor:

1. real container demux for MP4/MOV/WebM and common audio formats;
2. WebCodecs encoded-chunk decode queues;
3. worker pools and cancellation-aware prefetch windows;
4. proxy/thumbnail generation into the derived-media store;
5. GPU texture caches and WebGPU shader effect kernels;
6. sample-accurate offline audio render and automation curves;
7. encoded video/audio mux and deterministic export;
8. native/WASM codec/effect fallbacks.

## Evaluation contract

The UI does not ask a decoder to “render a clip”. It asks the core to evaluate composition `C` at time `t`.

The evaluation plan contains:

- composition size/background/frame;
- active source-backed Canvas layers;
- native text and shape draw items;
- active timeline clips and source times;
- evaluated transforms/keyframes;
- ordered effect stacks;
- active audio items.

A runtime fulfills the plan. This preserves semantic parity between interactive preview, still rendering and future offline export.

## Decode scheduling and cache

`WeightedLruCache` provides explicit memory budgets instead of unbounded browser object retention. `DecodeScheduler` provides:

- bounded concurrency;
- priority ordering;
- in-flight deduplication by cache key;
- cancellation support;
- idle synchronization.

The browser frame provider keys decoded frames by asset, quantized frame time, dimensions and media variant. Production decode should retain the same scheduling contract while moving work into workers/WebCodecs/native kernels.

## Audio

The core owns audio semantics rather than AudioContext nodes. Clip state includes gain in dB, pan and fades; core helpers convert the timeline into source-time/sample-time plans. The browser mixer consumes those plans and schedules decoded buffers.

This is a preview foundation, not yet a claim of sample-accurate browser export. Offline production rendering remains future work.

## Deliver

Outputs are graph nodes rather than transient export-dialog settings. A render manifest records:

- target composition/output settings;
- frame count/range;
- source dependencies and hashes;
- audio plan summary;
- a deterministic signature over relevant edit state.

The signature intentionally ignores timestamps while changing when render-affecting graph state changes. This is the basis for render caching, resumability and distributed execution.

## Source identity

Imported media gets a sampled SHA-256 fingerprint in addition to graph identity. The sampled fingerprint is optimized for fast relink/cache matching and is not presented as a full-file cryptographic digest.

Project files store a source manifest. Browser storage indexes source records by hash/name so a reopened project can recover a local source even when asset IDs differ.

## WebCodecs boundary

WebCodecs consumes encoded chunks; it does not demux MP4/MOV/WebM containers. Media capability-detects WebCodecs but still uses browser media-element frame capture until a proper demux layer exists. That boundary is deliberate.
