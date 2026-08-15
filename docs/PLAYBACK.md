# Playback

Cut consumes the evaluated composition, not a UI-selected clip.

Source-backed video decode uses range IO, keyframe-safe encoded windows, Worker scheduling and codec routing. Classic MP4, common fMP4 and WebM can avoid file-sized source buffers. The composition renderer uses latest-generation commit semantics so stale asynchronous seeks cannot paint over newer frames.

## Adaptive Cut preview fidelity

0.14 makes the frame-budget fidelity controller part of the normal Cut preview path instead of leaving it as an isolated adapter.

The preview loop is now:

```text
composition evaluation
  -> fidelity plan
  -> preview resolution / temporal / vector quality hints
  -> composition render
  -> measured render time + stale outcome
  -> next fidelity plan
```

`CompositionPlaybackEngine.presentEvaluated()` accepts an already evaluated composition so the fidelity layer does not evaluate the graph twice. The fidelity plan is attached to the scaled render plan and passed through both WebGPU and Canvas2D render calls.

Preview resolution is enforced immediately: scrubbing uses a reduced resolution, while normal playback scales between the configured minimum and full preview size from EWMA render cost and recent stale-frame pressure. Export fidelity remains full-resolution and preserves requested temporal/vector sample counts.

Scrub requests use an abortable generation. A newer seek cancels the previous interactive request, while ordinary playback keeps latest-generation commit semantics. Aborted or failed renders are tracked separately and do not pollute the fidelity controller's render-cost EWMA.

Temporal and vector sample counts are currently render-plan hints for the existing reference kernels; they are not yet a claim that multi-sample temporal accumulation or vector supersampling is the default real-time compositor path.

The GPU reference path represents blend/mask/transition/intrinsic nodes; unsupported masks/effects/color ingestion still fall back instead of changing creative semantics silently.
