# Media kernel

The kernel turns source bytes and evaluated creative intent into deterministic media work without coupling the Universal Creative Graph to browser APIs.

## 0.9 production path

```text
range source
  -> sparse container index
  -> seek/encoded window
  -> Worker decode
  -> bounded decoded cache
  -> evaluated composition
  -> GPU/Canvas preview

range source
  -> segmented derivative job
  -> streaming decoder -> scaler -> encoder
  -> bounded segment mux

render manifest
  -> resumable render chunks
  -> concurrent chunk A/V encode
  -> persisted fMP4 segments
  -> deterministic assembly/index
```

## Source contract

Media consumers depend on `size + read(offset,length)`. Classic MP4/MOV and common WebM are sparse-indexed; fragmented MP4 currently has a bounded full-read fallback until sparse `moof` indexing lands.

## Worker/codec contract

Worker decoding continues to stream `VideoFrame`/`AudioData` via progress messages. Compact encoded windows remain transferable and decoder-independent. The 0.9 proxy path removes decoded-frame batch retention by forwarding decoder outputs directly into the encoder.

## Output

Classic MP4/MOV, fMP4, WebM and WAV writers remain. Streaming WebM now writes terminal Cues. Resumable Studio delivery uses fMP4 because independently persisted media segments compose naturally with checkpointed render jobs.

## GPU/color

Evaluated source-backed layers can use a multi-layer WebGPU path. Unsupported plan features fall back to Canvas2D. SDR color conversion is explicit; HDR is not routed through the default rgba8 cache without an explicit tone-map policy.

## Next kernel work

1. sparse fragmented-MP4 `moof`/`mdat` range indexing;
2. live/unknown-size WebM Cluster indexing;
3. compressed-audio range decode instead of whole-Blob `AudioContext` decode;
4. masks, transitions and non-normal blend modes in the GPU composition graph;
5. float/HDR working-space render targets and explicit tone mapping;
6. seekable classic-MP4 finalization after resumable fMP4 renders;
7. larger real-media conformance/performance corpus and native/WASM codec fallbacks.
