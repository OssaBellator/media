# Media Engine Contracts

## Current execution model

The current browser implementation is deliberately split into three levels.

### Level A — semantic engine (implemented)

Pure JavaScript and testable in Node:

- graph and project invariants;
- timeline edits;
- transforms;
- keyframes;
- effects;
- transport math;
- composition evaluation;
- planner/provider validation.

This layer should remain stable even if the UI/runtime is replaced.

### Level B — browser media adapters (implemented foundation)

- media metadata probing;
- audio waveform decoding;
- sampled source fingerprinting;
- IndexedDB blob persistence;
- HTML media preview/seek;
- video-frame capture fallback;
- WebGPU/Canvas2D compositor bootstrap.

### Level C — production media kernels (next)

The next performance layer should add:

1. demuxers for MP4/MOV/WebM and common audio containers;
2. WebCodecs-backed frame/audio decode where supported;
3. worker-based decode queues and cache eviction;
4. proxy generation and optimized thumbnail/waveform caches;
5. WebGPU texture upload/compositing and shader effect kernels;
6. sample-accurate audio graph/mixer;
7. deterministic render/export pipeline;
8. WASM/native fallbacks for unsupported codecs and heavier effects.

## Render-plan philosophy

The UI should not ask a decoder to "render this clip" directly. It asks the core to evaluate a composition at time `t`, producing a plan. A runtime then fulfills that plan using the best available local/cloud implementation.

This enables:

- interactive preview and offline render to share semantics;
- deterministic agent operations;
- browser/native renderer parity;
- render caching by graph/time/source fingerprint;
- future distributed rendering.

## Source identity

Imported media receives a sampled SHA-256 fingerprint in addition to stable graph identity. The fingerprint is not currently treated as a cryptographic full-file hash; it samples source bytes plus type/size to make relinking and cache matching cheap for large media.

A production ingest pipeline can add a full content digest asynchronously without changing asset IDs.

## WebCodecs note

The Studio detects WebCodecs capability but does not claim direct MP4/MOV decode through `VideoDecoder` yet. WebCodecs consumes encoded chunks and therefore requires a demux layer. The current browser frame-capture helper intentionally uses an HTML media element until a demuxer is implemented.
