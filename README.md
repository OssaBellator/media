# Media

Media is an experimental unified creative workstation for image, video, audio, animation and emerging media.

The architectural thesis remains: **the creative project is the product, not a collection of application-specific files**. Canvas, Cut, Motion, Deliver and Agent are views over one Universal Creative Graph, reversible history and a shared media-kernel contract.

## Current milestone — 0.16

0.16 starts the runtime-ownership migration: playback and delivery are being moved out of autonomous DOM/storage bootstraps and behind reusable controllers that accept the current graph directly.

### One Cut session

`CutPlaybackSession` now owns presentation deduplication, scrub supersession, graph invalidation, targeted relink/source invalidation, fallback, lifecycle and metrics. It keys requests by immutable graph identity rather than misusing the graph schema version as an edit revision.

`createCutPlaybackRuntime()` assembles Worker/range decode, HTML/Canvas fallback, WebGPU composition and adaptive fidelity behind that session. The compatibility Cut bootstrap delegates engine state to this runtime and a direct browser bridge is available for the editor handoff.

### Graph-backed delivery session

`CompositionDeliverySession` accepts a graph and output node directly, builds the manifest, renders exact composition frames through the 0.15 temporal/vector fidelity path, supplies strict offline audio, selects H.264/AAC or VP9/Opus, and owns output cancellation/progress lifecycle.

Offline audio prefers range-selected compressed decode and falls back to whole-Blob Web Audio only for compatibility. Audible graph sources are never silently omitted.

The compatibility delivery bootstrap upgrades the advanced runtime's immediate MP4/WebM buttons to this graph-backed path. Existing resumable MP4, fast-start finalization, loudness analysis and proxy controls remain intact.

## Deliberate boundary

`app.js` still needs to instantiate these sessions directly and remove the compatibility IndexedDB/DOM observers. The legacy visible version badge also remains to be migrated with that file. 0.16 stabilizes the ownership APIs first so that handoff is a state-plumbing change rather than another media-engine rewrite.

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

See `docs/RUNTIME_016.md`, `docs/ARCHITECTURE.md`, `docs/PLAYBACK.md`, `docs/EXPORT.md`, `docs/MOTION_RENDERING.md`, `docs/KERNEL.md`, `docs/SOURCE_IO.md`, `docs/AUDIO.md`, `docs/CODECS.md`, `docs/CONFORMANCE.md` and `docs/ROADMAP.md`.
