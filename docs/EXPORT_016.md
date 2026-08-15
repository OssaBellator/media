# Delivery runtime integration — 0.16

`CompositionDeliverySession` is the headless orchestration boundary for local timeline output.

It accepts the in-memory graph and output ID, creates a render manifest, creates a graph-backed `CompositionFrameRenderer`, carries export temporal/vector fidelity into `renderCompositionTimelineExport()`, selects container codec policy, wires offline PCM when the graph contains audible sources, and owns cancellation/progress cleanup.

Immediate MP4/WebM buttons injected by the legacy advanced runtime are upgraded by `composition-delivery-bootstrap.js` to use this path. This makes those visible actions share the 0.15 composition renderer instead of the older single-sample frame factory.

Offline audio is strict. Range-selected compressed decode is preferred for MP4/MOV/WebM. If that path is unsupported, whole-Blob Web Audio is a compatibility fallback. If an audible graph source still cannot be decoded, delivery fails rather than silently dropping it.

Resumable fragmented MP4, fast-start finalization, loudness analysis and proxy controls remain on `advanced-runtime.js` in 0.16 and are intentionally not duplicated.
