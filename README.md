# Media

Media is an experimental unified creative workstation for image, video, audio, animation and emerging media.

The architectural thesis remains: **the creative project is the product, not a collection of application-specific files**. Canvas, Cut, Motion, Deliver and Agent are views over one Universal Creative Graph, reversible history and a shared media-kernel contract.

## Current milestone — 0.16

0.16 moves normal Cut playback and immediate composition delivery onto explicit runtime sessions owned by the Studio app instead of autonomous compatibility bootstraps.

### One Cut session

`CutPlaybackSession` owns presentation deduplication, scrub supersession, graph invalidation, targeted relink/source invalidation, fallback, lifecycle and metrics. It keys requests by immutable graph identity rather than misusing the graph schema version as an edit revision.

`app.js` now instantiates `createCutPlaybackRuntime()` directly, presents the in-memory graph at the current transport time, and invalidates the session explicitly on edits, imports, project opens and relinks. The old Cut compatibility bootstrap is no longer loaded by Studio.

### Graph-backed delivery session

`CompositionDeliverySession` accepts a graph and output node directly, builds the render manifest, renders exact composition frames through the temporal/vector fidelity path, supplies strict offline audio, selects H.264/AAC or VP9/Opus, and owns output cancellation/progress lifecycle.

`app.js` now instantiates this delivery runtime directly and routes immediate MP4/WebM delivery from the current graph. Offline audio prefers range-selected compressed decode and falls back to whole-Blob Web Audio only for compatibility; audible graph sources are never silently omitted.

### Adaptive hardening continues

DASH v2 now combines multi-period switching, event streams, synchronized `UTCTiming`, service-description latency, `availabilityTimeOffset` gating and incremental response chunks for low-latency incomplete segments. The legacy MPEG-TS HLS path is also implemented in the transport-stream kernel rather than remaining a roadmap placeholder.

## Deliberate boundary

The remaining Studio ownership debt is narrower but still real: `advanced-runtime.js` still discovers resumable MP4/finalization/loudness/proxy controls through a DOM observer and reloads graph state from storage, and `view.js` still displays a hardcoded `0.4` brand badge. `npm run check:ownership` reports these items as `todo` lines without treating them as completed work.

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

See `docs/RUNTIME_016.md`, `docs/ARCHITECTURE.md`, `docs/PLAYBACK.md`, `docs/EXPORT.md`, `docs/MOTION_RENDERING.md`, `docs/KERNEL.md`, `docs/SOURCE_IO.md`, `docs/ADAPTIVE_STREAMING.md`, `docs/MPEG_TS.md`, `docs/AUDIO.md`, `docs/CODECS.md`, `docs/CONFORMANCE.md` and `docs/ROADMAP.md`.
