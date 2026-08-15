# Media

Media is an experimental unified creative workstation for image, video, audio, animation and emerging media.

The architectural thesis remains: **the creative project is the product, not a collection of application-specific files**. Canvas, Cut, Motion, Deliver and Agent are views over one Universal Creative Graph, reversible history and a shared media-kernel contract.

## Current milestone — 0.15

0.15 turns the adaptive fidelity values introduced in 0.13 and integrated into Cut in 0.14 into **executable composition quality**.

### Executable temporal fidelity

Motion blur is explicit graph state, not a renderer guess. Compositions carry an opt-in shutter policy (`motionBlurEnabled`, shutter angle, phase and weight curve). When it is enabled, the fidelity plan's temporal sample count drives real sub-frame composition evaluation and weighted pixel accumulation. The already-evaluated center sample is reused when present, and stale/aborted work keeps the existing cancellation semantics.

Scrubbing still collapses to a single sample. Playback can shed temporal work under pressure. Export can request the full reference sample count.

### Executable vector fidelity and mask parity

Vector masks are now first-class compositing masks. Their signed-distance rasterizer consumes the adaptive vector supersample level, with deterministic feather/invert alpha generation. Canvas2D now applies asset and vector masks instead of silently ignoring mask state, including masked text and shape layers through source-space intrinsic rasterization.

For WebGPU, source-backed vector masks are materialized as source-sized synthetic mask textures after the source frame dimensions are known. The synthetic identity includes shape, source and supersample level so the texture cache cannot reuse a lower-quality or stale matte. Unsupported intrinsic vector-mask GPU cases fall back to the deterministic Canvas path rather than changing semantics.

### Graph-backed Deliver frames

`CompositionFrameRenderer` renders a graph at an exact output time/size using the same mask and temporal fidelity rules. `renderCompositionTimelineExport()` bridges that renderer into the existing WebCodecs MP4/WebM Deliver runtime, including progressive export, so preview/reference rendering and encoded output share the same composition semantics.

## Deliberate 0.15 boundaries

The temporal reference path currently accumulates rendered 8-bit RGBA Canvas2D frames; it is a correctness path, not yet a scene-linear HDR GPU temporal accumulator. There is no optical-flow/motion-vector blur. Vector matte supersampling is currently capped at 4x. WebGPU intrinsic vector masks fall back to Canvas2D. The legacy top-level Studio `app.js` still needs to be migrated onto the newer Cut and full timeline Deliver runtime.

## Run locally

```sh
npm run dev
npm test
npm run syntax:check
npm run build
npm run check
npm run conformance
npm run stress
```

## Engineering principle

The UI is not the source of truth. Gestures, agents, Workers, adaptive manifests, range/segment sources, codec/decryptor/plugin backends, GPU passes, derivative jobs and resumable render checkpoints converge on the same graph/evaluation/kernel contracts.

See `docs/ARCHITECTURE.md`, `docs/ENGINE.md`, `docs/KERNEL.md`, `docs/SOURCE_IO.md`, `docs/LIVE_MEDIA.md`, `docs/ADAPTIVE_STREAMING.md`, `docs/MPEG_TS.md`, `docs/PLAYBACK.md`, `docs/EXPORT.md`, `docs/GPU.md`, `docs/MOTION_RENDERING.md`, `docs/AUDIO.md`, `docs/CODECS.md`, `docs/CONFORMANCE.md`, `docs/STRESS.md`, `docs/PROJECT_FORMAT.md`, `docs/DECISIONS.md` and `docs/ROADMAP.md`.
