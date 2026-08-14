# Cut playback

## 0.9 path

```text
transport time
  -> evaluateComposition(graph, time)
  -> bounded preview plan
  -> resolve every source-backed visual item
       -> range source
       -> sparse demux index
       -> keyframe-safe decode window
       -> compact encoded bytes
       -> Worker/WebCodecs decode
       -> bounded decoded-frame cache
  -> WebGPU multi-layer composition when fully supported
     OR Canvas2D composition fallback
  -> latest-generation commit
```

Cut no longer duplicates timeline semantics by manually picking one active clip. Transforms, effects, z-order and clip source-time mapping come from the same evaluated plan used by Deliver.

## Latest-wins presentation

Frame resolution is asynchronous. Every present request receives a generation number. The renderer resolves sources into a scratch/queued representation first; if a seek/newer frame supersedes the request, no old frame is committed to the visible surface.

## GPU eligibility

The initial multi-layer GPU path covers source-backed layers/clips with normal blending and brightness/contrast/saturation/hue/blur/opacity. Text, native shapes, unsupported effects or non-normal blending fall back to Canvas2D for semantic parity.

GPU and Canvas use separate canvases. A WebGPU context initialization failure cannot make the Canvas2D fallback unavailable.

## Compatibility

`CutPlaybackEngine` still accepts the 0.8 `blobResolver` constructor option. It wraps returned Blobs in a range source, so existing callers keep working while the Studio factory uses the range-source API directly.
