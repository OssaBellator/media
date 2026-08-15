# Export and delivery

Media supports in-memory classic MP4/WebM, progressive fMP4/WebM and resumable fMP4 render checkpoints.

## Graph-backed composition frames

0.15 adds `CompositionFrameRenderer` as the frame-generation boundary for Deliver. It evaluates the Universal Creative Graph at a requested output time, applies an exact output-size plan and uses the same vector-mask and explicit temporal-fidelity semantics as composition preview.

`renderCompositionTimelineExport()` connects that renderer to the existing WebCodecs delivery runtime:

```text
Universal Creative Graph
  -> evaluate composition at output time
  -> vector-mask / temporal fidelity execution
  -> exact output canvas
  -> VideoFrame
  -> WebCodecs encoder
  -> MP4 / fMP4 / WebM muxer
```

Export fidelity stays full-resolution and can request reference temporal/vector quality independently of the adaptive preview budget. Motion blur still requires explicit composition shutter intent; requesting eight temporal samples does not invent blur on a composition where it is disabled.

The current temporal reference renderer performs 8-bit RGBA Canvas2D accumulation. Scene-linear HDR temporal accumulation is not yet claimed. If the requested output aspect ratio differs from the composition, the current frame renderer scales the rendered composition to the exact output dimensions; fit/fill/crop delivery policy remains future work.

## Resumable render

Each render chunk owns global output timestamps and can persist picture+audio as an independent fMP4 media segment. Cancellation releases an active chunk without consuming a retry; completed segments survive reload/crash.

## Streaming classic MP4 finalization

Streaming finalization reads persisted fragmented checkpoints through a lazy range source, precomputes a fast-start `moov` and writes sample payloads to the output sink without rebuilding the final file in memory.

The final writer now uses the shared MP4 chunk planner as its payload-layout policy: samples are grouped into bounded same-track chunks by byte count, media duration and sample count, then those chunks are interleaved by decode time. `stsc` and `co64` are derived from that exact planned payload order, so long A/V outputs no longer degenerate into packet-per-chunk tables when audio and video timestamps alternate.

The default streaming policy targets one-second chunks, up to 8 MiB and 4096 samples per chunk; callers can override those bounds through `planStreamingMp4()` / `writeStreamingMp4()` options. Single-track runs and exact payload offsets remain deterministic.

The writer preserves AVC/HEVC/AV1 decoder descriptions, AAC AudioSpecificConfig, signed composition offsets, non-zero track starts, rotation, pixel aspect, nclx color state and CLLI/MDCV HDR metadata.

Protected fMP4 remains rejected by the finalizer unless a downstream authorized clear-media path is deliberately implemented; Media does not silently strip encryption signaling while copying encrypted bytes into a clear sample entry.

## Audio

Offline compressed audio prefers range-selected AAC/Opus decode into sparse PCM. Encrypted audio fails before WebCodecs unless an authorized exact-sample decryptor is injected. Whole-source Web Audio decode remains compatibility fallback for unprotected formats outside the range decoder.
