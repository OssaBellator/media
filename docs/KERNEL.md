# Media kernel

## Purpose

The kernel boundary turns container bytes and creative render intent into deterministic media work without coupling project semantics to browser APIs. The same protocol can run inline, in browser Workers, in a future native process or on remote render workers.

## Protocol and scheduling

`media.kernel.v1` defines task, progress, result, error and cancellation messages. Studio provides inline/Worker clients, transfer-safe ArrayBuffer posting, recursive transferable discovery, a bounded priority Worker pool, keyed deduplication, cancellation, idle synchronization and playhead-driven prefetch.

## Containers

### WAV

RIFF/WAVE parse/decode and PCM/float encode are implemented.

### MP4/MOV

Common classic sample-table demux and common fragmented-MP4 indexing are implemented. 0.7 adds the reverse direction:

- classic fast-start AVC/AAC MP4/MOV writing;
- `edts/elst` parse/application for simple 1× edits;
- leading-empty-edit generation when muxed tracks start after movie zero;
- long-duration version-1 `mdhd` output;
- fMP4 initialization plus `moof/mdat` media-segment writing.

The MP4 writer remains intentionally scoped: AVC + AAC are the common supported output codecs, it is in-memory, and advanced metadata/color/subtitle/sample-group features remain future work.

### WebM

WebM track/block/lacing/Cue demux and VP8/VP9/AV1 + Opus/Vorbis mux are implemented. The writer is currently in-memory rather than a streaming sink.

## WebCodecs boundary

Browser adapters convert normalized encoded chunk descriptors to `EncodedVideoChunk` / `EncodedAudioChunk`, decode them, and perform the reverse with `VideoEncoder` / `AudioEncoder`. `createMuxPlanFromEncoded` now preserves decoder configuration metadata directly into the mux layer.

## Seeking

Keyframe-safe seek indexes remain decoder-independent. 0.7 fixes an exact-boundary overlap bug: a chunk ending exactly at `decodeStart` is no longer treated as overlapping the decode window.

## Derived media

Thumbnail and proxy tasks now have executable browser implementations.

### Thumbnail

Seek → small decode window → nearest decoded frame → Canvas resize → image Blob.

### Proxy

Demuxed chunks → WebCodecs decode → resize → VP9/AV1 encode → optional Opus audio → WebM mux.

The initial proxy path is batch-oriented with explicit retained-frame caps. Large media should be partitioned into smaller proxy jobs until streaming decoder→encoder handoff is implemented.

## Offline audio

Float32 PCM resampling, gain, pan, fades, normalization and mix-plan rendering remain deterministic core operations. WAV closes a lossless/uncompressed output path; compressed audio can use WebCodecs where supported.

## Production DAG

```text
source bytes
   ├─> demux -> seek/prefetch -> decode -> preview/render
   ├─> thumbnail/proxy derived jobs
   └─> render -> encode -> mux -> Deliver artifact
```

Render manifests remain partitionable into resumable frame jobs with retries and interruption recovery.

## Next kernel work

1. streaming MP4/WebM writers and resumable output sinks;
2. HEVC/AV1 MP4 output configuration and broader sample entries;
3. Studio playback driven by the Worker pool instead of HTML-media fallback;
4. segmented/resumable proxy generation persisted into derived storage;
5. WebGPU texture caches and shader effect kernels;
6. offline audio automation and loudness analysis;
7. WASM/native codec fallbacks;
8. a large real-world camera/browser/container conformance corpus.
