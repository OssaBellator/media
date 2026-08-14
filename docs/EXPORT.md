# Export and derived-media paths

## Goal

Deliver does not invent a second rendering model. It consumes evaluated project state and turns it into encoded media through the same kernel contracts used for preview and derivatives.

## Full timeline render

The browser reference can now perform:

```text
Creative Graph
  -> composition evaluation at each output frame
  -> Canvas render
  -> VideoFrame
  -> WebCodecs VideoEncoder
  + offline automated PCM mix -> AudioData -> AudioEncoder
  -> encoded-stream bridge
  -> MP4 / fMP4 / WebM
```

In-memory MP4/WebM remains useful for smaller jobs. Explicit streaming output uses a byte sink and progressive container writer.

## Progressive output

`renderProgressiveTimelineExport()` prepares the optional audio stream, then renders/encodes picture sequentially with `retainChunks:false`. Encoded video is drained into bounded container segment queues.

### fragmented MP4

The sink receives one initialization segment followed by `moof + mdat` media segments. Video keyframes define segment boundaries; corresponding encoded audio chunks are assigned to those intervals.

### WebM

The sink receives an EBML header plus an unknown-size Segment and incrementally written Clusters. This mode intentionally omits a final Cue table because it never seeks backward to patch the stream.

`MemoryByteSink`, `CountingByteSink` and `writableStreamByteSink` provide common sink contracts. In Studio, File System Access is used when available for explicit streamed export.

## MP4 codecs and presentation metadata

Classic/fMP4 video sample entries currently support:

- AVC: `avc1` / `avc3` + `avcC`;
- HEVC: `hvc1` / `hev1` + `hvcC`;
- AV1: `av01` + `av1C`.

AAC remains the implemented MP4 audio output path. Decoder descriptions are required for HEVC/AV1 and are normally supplied by WebCodecs encoder metadata.

The mux bridge preserves and the MP4 writer can emit color space, track rotation, pixel aspect, content-light and mastering-display metadata. Matching demux helpers read those boxes back into track metadata.

## Derived media

### thumbnails

Keyframe-safe window → compact source bytes → decode → nearest frame → Canvas encode.

### proxies

A proxy job is divided into resumable keyframe-aligned segments. Segment status and artifacts are stored in IndexedDB. Each video segment gets a compact source window before the existing bounded VP9/AV1 + optional Opus WebM transcode. A manifest ties completed segment artifacts back to source identity and requested proxy specification.

The transcode inside one segment still collects a bounded decoded frame batch. The next step is decoder-output → scaler → encoder streaming within each segment.

## Audio delivery

Offline rendering honors clip gain/pan/fades, playback rate, clip gain/pan automation and output/master gain automation. Output nodes may define a loudness target and peak ceiling; Studio can also run loudness analysis without rendering a media file.

The loudness implementation is BS.1770-style with K weighting, absolute/relative gates, standard surround weights and a windowed-sinc intersample estimate. It is a deterministic engineering reference, not a certified broadcast compliance meter.

## Remaining export work

- simultaneous progressive A/V scheduling rather than audio-first preparation;
- resumable final-render segment state connected to the render-job DAG;
- full source-range IO, native/WASM codec fallbacks and larger fixtures;
- color transforms/tone mapping in addition to metadata preservation;
- subtitle/data tracks, advanced sample groups and broader container brands;
- fully streaming proxy transcode internals and final proxy stitching/indexing.
