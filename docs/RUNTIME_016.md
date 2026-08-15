# Runtime ownership — 0.16

0.16 collapses normal Cut playback and immediate composition delivery into reusable runtime controllers owned by the Studio app.

## Cut

`CutPlaybackSession` owns request deduplication, scrub cancellation, graph invalidation, source/relink invalidation, failure fallback, lifecycle and metrics. Immutable graph object identity participates in the presentation key; `graph.version` is deliberately not used as an edit revision because it is the graph schema version.

`createCutPlaybackRuntime()` assembles Worker/range playback, fallback decoding, composition rendering, WebGPU and adaptive fidelity behind that session. `app.js` instantiates the runtime directly and presents the current in-memory graph at the transport time. Edits, undo/redo, imports, project opens and relinks explicitly invalidate graph or source state.

The browser bridge and old compatibility bootstrap remain available as reusable/compatibility modules, but Studio no longer loads the Cut bootstrap from `index.html`.

## Deliver

`CompositionDeliverySession` is a headless output orchestrator. It accepts the graph directly, builds the render manifest, creates an exact graph-backed frame renderer, carries temporal/vector fidelity into `renderCompositionTimelineExport()`, enforces MP4 H.264/AAC or WebM VP9/Opus policy, and owns output cancellation/progress lifecycle.

`OfflineAudioSession` refuses silent source omission. The browser runtime prefers range-selected compressed decode, then uses whole-Blob Web Audio only as a compatibility fallback. Gain, pan, fades, clip automation, master automation and optional loudness normalization use the existing graph audio plan and deterministic PCM mixer.

`app.js` now owns this delivery session directly for immediate MP4/WebM output. The old composition-delivery bootstrap is no longer loaded by Studio.

## Remaining ownership boundary

The migration is not fully complete. `advanced-runtime.js` still owns the compatibility surface for resumable MP4 checkpoints, fast-start finalization, loudness analysis and proxy generation. It currently discovers those controls with a `MutationObserver` and reloads graph state from IndexedDB instead of accepting the app's current graph directly.

The visible brand badge in `view.js` also remains hardcoded to `0.4` even though the runtime/footer version is 0.16. These remaining items are deliberately reported as `todo` lines by `scripts/check-runtime-ownership.mjs`; they are not counted as completed ownership checks.

The next Studio handoff should turn the advanced operations into explicit graph-backed commands, render their progress/cancel state as first-class view state, remove the last autonomous DOM/storage observer, and source the brand badge from `appVersion`.
