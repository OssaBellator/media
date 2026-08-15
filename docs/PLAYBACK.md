# Playback

Cut consumes the evaluated composition, not a UI-selected clip.

Source-backed video decode uses range IO, keyframe-safe encoded windows, Worker scheduling and codec routing. Classic MP4, common fMP4 and WebM can avoid file-sized source buffers. The composition renderer uses latest-generation commit semantics so stale asynchronous seeks cannot paint over newer frames.

## Adaptive Cut preview fidelity

The preview loop is:

```text
composition evaluation
  -> fidelity plan
  -> preview resolution / temporal / vector quality
  -> composition render
  -> measured render time + stale outcome
  -> next fidelity plan
```

`CompositionPlaybackEngine.presentEvaluated()` accepts an already evaluated composition so the fidelity layer does not evaluate the graph twice. Preview resolution is enforced immediately: scrubbing uses a reduced resolution, while normal playback scales between the configured minimum and full preview size from EWMA render cost and recent stale-frame pressure.

## Executable temporal fidelity

0.15 makes temporal fidelity executable when the composition explicitly enables motion blur. The evaluated composition carries a normalized shutter policy. `temporalSamplesForFidelity()` expands that policy into weighted sub-frame times and `renderTemporalCompositionToCanvas2D()` re-evaluates the graph at those times, renders each sample and accumulates the RGBA result.

The center evaluated plan is reused when its timestamp is present in the shutter schedule. Scrub fidelity still uses one sample, so interactive seeking does not accidentally trigger multi-sample work. Motion blur is never inferred from a high sample-count request alone.

The current temporal accumulator is the deterministic Canvas2D/CPU reference path. It accumulates rendered 8-bit RGBA frames; scene-linear/HDR accumulation and a production GPU temporal resolve remain future optimizations.

## Executable vector fidelity

Vector masks are normalized as first-class mask sources. Their signed-distance matte rasterizer consumes `vectorSupersample` from fidelity, capped at the current 4x reference-kernel limit.

Canvas2D applies both asset and vector masks, including alpha/luma asset masks, invert, opacity and feather. Text and shape items with masks are first rasterized into source-space drawables and then use the same transform/effect/mask path as media assets.

WebGPU source-backed vector masks are adapted to source-sized synthetic mask textures after source dimensions are known. Shape/source/supersample state participates in the synthetic cache identity. Intrinsic vector-mask GPU cases fall back to Canvas2D rather than using incorrect UV alignment.

Scrub requests remain abortable. Aborted/failed renders do not pollute the fidelity controller's render-cost EWMA.
