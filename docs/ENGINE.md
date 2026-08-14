# Media engine contracts

Media separates creative semantics from media execution so the same project can be evaluated by browser preview, workers, a future native editor or a render farm.

## Level A — semantic engine

Implemented and DOM-free: graph invariants, atomic operations, timeline edits, transforms, text/shapes, keyframes/effects, composition evaluation, audio mix plans, delivery manifests, caches, source identity and planner/provider validation.

## Level B — browser runtime

Implemented foundation: metadata/fingerprint probing, IndexedDB source + derived storage, frame caching/scheduling, HTML-media frame fallback, Canvas2D still composition, AudioContext preview mixing, WebGPU bootstrap, and in 0.5 a versioned Worker/inline media-kernel client.

## Level C — production media kernel

0.5 begins this layer rather than treating it only as roadmap:

- versioned kernel task/progress/result/error/cancel protocol;
- cancellable handler runtime;
- normalized demux track/chunk/decoder descriptors;
- real PCM/float WAV parsing and decode;
- ISO-BMFF box/brand/movie-header parsing foundation;
- EBML/WebM header parsing foundation;
- keyframe seek/prefetch indexes;
- deterministic proxy/thumbnail/waveform derivative plans;
- Float32 PCM offline resampling/mixing primitives;
- mux/interleave/segment plans;
- resumable chunked render jobs;
- production render DAG from source verification through mux.

Still required for professional encoded video export:

1. full MP4/MOV sample-table and fragmented-media demux;
2. WebM Tracks/Cluster/Cues/block extraction;
3. WebCodecs adapters consuming encoded chunks;
4. real worker-pool decode/prefetch and proxy generation;
5. GPU texture caches and shader effect kernels;
6. offline audio automation/encoding;
7. video/audio encoders and actual MP4/WebM container writers;
8. native/WASM fallbacks.

## Evaluation contract

The UI asks the core to evaluate composition `C` at time `t`; the result contains visual/audio draw state, source times, transforms, keyframes and effects. Runtime implementations fulfill that plan. Preview, still rendering and future offline export therefore share semantics.

## Decode and seek contract

Container parsers produce normalized track/chunk descriptors. Seek indexes map encoded chunks to keyframes and calculate directional decode windows. A decoder implementation can therefore change—from HTML media fallback to WebCodecs, WASM or native—without changing timeline semantics.

## Audio contract

The Creative Graph owns gain/pan/fades and timeline/source timing. Core audio plans are translated either into AudioContext preview scheduling or deterministic Float32 PCM offline mixing. Optimized SIMD/WASM/native mixers can later replace the reference implementation behind the same contract.

## Deliver and render jobs

Outputs remain graph nodes. Deterministic render manifests can now be partitioned into resumable frame chunks with retry and interruption recovery. `createProductionPipeline` expands that into an acyclic pipeline for source verification, optional derivatives, frame rendering, audio rendering, encoding and mux.

## Container honesty

WebCodecs consumes encoded chunks; it does not demux containers. The 0.5 MP4/MOV and WebM parsers are deliberately described as structural foundations, not full demuxers. WAV PCM/float decode is genuinely implemented.

See `docs/KERNEL.md` for the detailed kernel boundary.
