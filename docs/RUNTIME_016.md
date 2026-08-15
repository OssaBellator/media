# Runtime ownership — 0.16

0.16 starts collapsing the Studio's autonomous browser bootstraps into reusable runtime controllers.

## Cut

`CutPlaybackSession` owns request deduplication, scrub cancellation, graph invalidation, source/relink invalidation, failure fallback, lifecycle and metrics. Immutable graph object identity participates in the presentation key; `graph.version` is deliberately not used as an edit revision because it is the graph schema version.

`createCutPlaybackRuntime()` assembles Worker/range playback, fallback decoding, composition rendering, WebGPU and adaptive fidelity behind that session. `installCutPlaybackBridge()` exposes a direct browser API and events (`media:cut-present`, `media:graph-invalidated`, `media:asset-relinked`) so the editor can hand over its in-memory graph and transport state without reworking the media engine.

The compatibility `cut-playback-bootstrap.js` now delegates cancellation/invalidation to this runtime. Its IndexedDB/timecode discovery remains a temporary bridge until `app.js` owns the session directly.

## Deliver

`CompositionDeliverySession` is a headless output orchestrator. It accepts the graph directly, builds the render manifest, creates an exact graph-backed frame renderer, carries temporal/vector fidelity into `renderCompositionTimelineExport()`, enforces MP4 H.264/AAC or WebM VP9/Opus policy, and owns output cancellation/progress lifecycle.

`OfflineAudioSession` refuses silent source omission. The browser runtime prefers range-selected compressed decode, then uses whole-Blob Web Audio only as a compatibility fallback. Gain, pan, fades, clip automation, master automation and optional loudness normalization use the existing graph audio plan and deterministic PCM mixer.

`composition-delivery-bootstrap.js` upgrades the legacy advanced runtime's immediate MP4/WebM buttons so those actions use the 0.15 graph-backed temporal/vector frame path. Resumable MP4, finalization, loudness analysis and proxy controls remain on the existing advanced runtime for this milestone.

## Boundary

This is an integration milestone, not the final ownership migration. `app.js` still needs to instantiate the Cut and Deliver sessions directly, remove the compatibility storage/DOM observers, expose render progress/cancel in first-class view state, and update the visible legacy version badge.
