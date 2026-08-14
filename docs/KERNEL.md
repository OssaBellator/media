# Media kernel

## Purpose

The kernel boundary turns container bytes and render intent into deterministic media work without coupling creative semantics to browser APIs. The same protocol can be fulfilled inline, by browser Workers, by a future native process or by remote render workers.

## Protocol and scheduling

`media.kernel.v1` defines task, progress, result, error and cancellation messages. The core `KernelRuntime` owns handlers and abort semantics. The Studio adds:

- inline and Worker clients;
- transfer-safe task construction for zero-copy ArrayBuffer posting;
- recursive transferable collection for result messages;
- a bounded priority Worker pool;
- keyed in-flight/queued deduplication;
- cancellation and idle synchronization;
- playhead-driven prefetch windows based on the core seek index.

## Containers

### WAV — implemented decode and encode

The core parses RIFF/WAVE chunks and decodes PCM 8/16/24/32-bit plus IEEE float 32/64-bit input into planar Float32 PCM. It also writes RIFF/WAVE output for integer PCM 8/16/24/32-bit and float32.

### MP4/MOV — sample demux implemented for common paths

The ISO-BMFF parser now covers the classic non-fragmented sample-table path:

- track/media headers and handler types;
- `stsd` sample descriptions;
- `stts` decode timing;
- `ctts` composition offsets;
- `stsc` sample-to-chunk mapping;
- `stsz` and compact `stz2` sample sizes;
- `stco` / `co64` chunk offsets;
- `stss` sync samples;
- AVC `avcC` decoder descriptions / codec strings;
- AAC `esds` AudioSpecificConfig extraction.

The same demuxer also indexes common fragmented MP4 using `mvex/trex` defaults and `moof/traf/tfhd/tfdt/trun` sample records. Both paths resolve normalized encoded chunks containing byte offset/length, decode and presentation timestamps, duration, sequence and keyframe status.

Remaining MP4 work includes edit-list application, broader codec configuration parsing, more fragmented-base-offset conformance cases and an actual MP4 writer.

### WebM — track and block demux implemented

The EBML/WebM parser covers:

- EBML and unknown-size Segment parsing;
- Info timecode scale/duration;
- Tracks and CodecPrivate;
- video/audio metadata;
- Cluster timecodes;
- SimpleBlock and BlockGroup;
- ReferenceBlock keyframe semantics;
- fixed, Xiph and EBML lacing;
- Cues/seek points;
- source byte ranges for every demuxed frame.

The WebM writer currently emits EBML/Segment/Info/Tracks, Clusters, SimpleBlocks and keyframe Cues for WebM-native VP8/VP9/AV1 + Opus/Vorbis tracks. It is currently an in-memory writer, not a streaming muxer.

## WebCodecs boundary

Browser adapters now convert normalized demux descriptors into `EncodedVideoChunk` / `EncodedAudioChunk`, configure the corresponding WebCodecs decoder and collect output frames. Encoder adapters perform the inverse operation: VideoFrame/AudioData input becomes copied encoded sample records suitable for the mux plan/writer layer.

This preserves the core contract when WebCodecs is unavailable: another decoder/encoder implementation can fulfill the same track/chunk interfaces.

## Seeking and prefetch

Demuxers produce keyframe-aware chunks. `createSeekIndex` and the Worker-pool prefetch controller derive a safe preceding keyframe and directional decode horizon. Decoder choice is not embedded in seek semantics.

## Offline audio

Float32 PCM primitives provide linear resampling, gain, constant-power pan, fades, normalization and mix-plan rendering. WAV output closes one deterministic offline-audio export path; compressed audio encoding can use WebCodecs where supported.

## Proxies and derived media

Derivative plans produce stable keys from source identity plus derivative specification. The existing derived-artifact IndexedDB store remains the persistence target. Actual proxy/thumbnail generation should now be implemented as kernel tasks using demux + WebCodecs + render/encode primitives rather than HTML media elements.

## Render jobs and production DAG

Render manifests partition into resumable frame chunks with retries, interruption recovery and ordered artifact manifests. `createProductionPipeline` models source verification, optional derivatives, frame/audio render, encode and mux dependencies.

```text
source bytes
   ├─> demux -> seek/prefetch -> decode -> preview/render
   ├─> derivative/proxy pipeline
   └─> render -> encode -> mux -> Deliver artifact
```

## Next kernel work

1. MP4 binary mux writer and fragmented-MP4 writer;
2. MP4 edit lists and broader codec/sample-entry configuration coverage;
3. WebM streaming writer and richer cue/seek metadata;
4. real proxy/thumbnail generation into derived storage;
5. Worker-pool integration into Studio playback rather than standalone adapter coverage;
6. WebGPU texture caches and shader effect kernels;
7. offline audio automation curves and loudness analysis;
8. broader codec fallback strategy with WASM/native adapters;
9. large real-world fixture/conformance corpus for container edge cases.
