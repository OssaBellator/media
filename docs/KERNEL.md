# Media kernel

## Purpose

The kernel boundary turns container bytes and creative render intent into deterministic media work without coupling project semantics to browser APIs. The same protocol can run inline, in browser Workers, in a future native process or on remote render workers.

## 0.8 playback/decode path

Cut now consumes the kernel rather than treating it as a separate experiment:

```text
timeline time
  -> active visual clip
  -> source time
  -> keyframe-safe decode window
  -> compact encoded byte window
  -> priority Worker task
  -> streamed VideoFrame progress
  -> bounded decoded-frame cache
  -> GPU texture cache / Canvas2D
```

`decode-video` and demuxed `decode-audio` tasks support streaming output. A Worker transfers each media object inside a `media.kernel.v1` progress message; final task results contain counters instead of requiring an entire decoded batch. The original non-streaming result form remains available for callers that need it.

The browser reference still demuxes the source into memory before compacting individual decode windows. A range-addressable demux/source abstraction is later work.

## Scheduling and memory

- priority Worker pool with keyed deduplication and cancellation;
- compact encoded windows rewrite chunk offsets against a small transferable buffer;
- bounded decoded-frame cache closes evicted `VideoFrame`s;
- source fingerprint changes invalidate cached demux/frame state;
- progressive encoders can disable encoded-chunk retention after `onChunk` delivery.

## Containers and presentation metadata

### MP4/MOV

Classic/fMP4 demux and classic/fMP4 writing remain implemented. 0.8 expands video output from AVC to HEVC and AV1 when the encoder supplies the corresponding `hvcC`/`av1C` decoder description.

The writer can emit and the metadata parser can read:

- `colr` / `nclx` color primaries, transfer, matrix and full-range flag;
- `pasp` pixel aspect;
- `clli` content-light metadata;
- `mdcv` mastering-display metadata;
- `tkhd` 0/90/180/270-degree rotation matrices.

This is structural metadata preservation, **not yet a complete color-management or HDR tone-mapping pipeline**.

### WebM

The existing indexed in-memory writer remains available. `StreamingWebmWriter` writes an unknown-size Segment, Info/Tracks and Clusters directly to a byte sink. Because the stream is forward-only it currently omits a final seek/Cue table.

## Derived media

Proxy work is now represented as resumable segment jobs. Segments prefer keyframe boundaries, persist attempts/status/artifact keys, recover interrupted running state, and compact the video byte window before transcode. The current per-segment browser proxy implementation is still batch-decoded with explicit frame caps; segmenting keeps that batch bounded.

## Production output

`FragmentedMp4StreamWriter` and `StreamingWebmWriter` target a generic async byte sink. Browser File System Access can therefore receive media without constructing one final container-sized `Uint8Array`.

`renderProgressiveTimelineExport` additionally runs the video encoder with retained-chunk storage disabled and drains encoded video into the writer in bounded segment queues. The browser reference prepares encoded audio before progressive video output; fully simultaneous A/V production scheduling remains future work.

## GPU boundary

Decoded frames can be copied into persistent `GPUTexture`s managed by an LRU byte budget. External video textures are intentionally not used as the cache primitive because their lifetime is tied to the source frame. A single WGSL pass currently handles the common scalar visual effects.

## Audio boundary

Offline audio now has graph-addressable automation curves, sample-domain automated mixing, K-weighted gated loudness analysis, surround weighting and an intersample peak estimate. See `docs/AUDIO.md` for accuracy boundaries.

## Next kernel work

1. range-addressable source/demux IO instead of full-source ArrayBuffers;
2. multi-layer GPU Cut composition rather than top-active-video playback;
3. decoder-output → proxy-encoder handoff without per-segment frame arrays;
4. simultaneous progressive audio/video export and resumable render segments;
5. streaming WebM Cues/SeekHead and richer fMP4 indexing/manifests;
6. full color-management transforms, HDR tone mapping and ICC/metadata policy;
7. more GPU effect kernels, masks and color transforms;
8. WASM/native codec fallbacks and a large real-world conformance corpus.
