# Media kernel

## Purpose

The kernel boundary turns container bytes and render intent into deterministic media work without coupling creative semantics to browser APIs. The same task protocol can be fulfilled by an inline browser handler, a Web Worker, a future native process or a remote render worker.

## Protocol

`media.kernel.v1` defines task, progress, result, error and cancellation messages. Supported task categories currently include demux, video/audio decode, video/audio encode, thumbnail, proxy, waveform and mux. A `KernelRuntime` owns handlers and cancellation via `AbortController`; the Studio exposes Worker and inline clients.

## Containers

### WAV — implemented decode

The core parses RIFF/WAVE chunks, validates `fmt ` and `data`, and decodes PCM 8/16/24/32-bit plus IEEE float 32/64-bit samples into Float32 PCM buffers.

### MP4/MOV — structural parser foundation

The ISO-BMFF parser currently handles normal/extended top-level boxes, `ftyp` brands and version 0/1 `mvhd` movie timing. It is enough for structural inspection but **not** yet sample extraction. Production demux still needs track/sample-table parsing (`trak/mdia/minf/stbl`, `stsd`, `stts`, `ctts`, `stsc`, `stsz`, `stco/co64`, `stss`) and fragmented-media boxes where relevant.

### WebM — structural parser foundation

The EBML parser implements variable integers, element headers, child iteration and EBML DocType discovery. Production WebM demux still needs Segment/Info/Tracks/Cluster/Cues parsing and block/lacing extraction.

## Encoded chunks and seeking

The core has normalized track descriptors, decoder-config projection, encoded chunk descriptors, ordering validation, keyframe-aware chunk windows and seek indexes. Directional prefetch windows are independent of a particular decoder implementation.

## Offline audio

Float32 PCM primitives provide linear resampling, gain, constant-power pan, fades, normalization and mix-plan rendering. These are deterministic core operations; optimized SIMD/WASM/native implementations can replace the loops later without changing the contract.

## Proxies and derived media

Derivative plans produce deterministic keys from source identity + derivative spec. Current plan types include thumbnails, video proxies and waveform analysis. The 0.4 derived-artifact IndexedDB store is the browser persistence target for these tasks.

## Render jobs

Render manifests can be partitioned into deterministic frame chunks. Jobs support claims, attempts, retry, interruption recovery, frame-weighted progress and an ordered final artifact manifest. This is the basis for worker pools and distributed rendering.

## Production pipeline DAG

`createProductionPipeline` expands a render manifest into an acyclic task graph:

```text
verify sources
   ├─> optional derivatives/proxies
   ├─> render frame chunks -> encode video chunks ─┐
   └─> render audio -------------------------------┼-> mux
                                                   ┘
```

Optional derivative failures can be skipped without invalidating required render work. Required failures block completion.

## Next kernel work

1. full MP4/MOV sample-table and fragmented-MP4 demux;
2. WebM Tracks/Cluster/Cues/block demux;
3. WebCodecs adapters that consume demuxed encoded chunks;
4. Worker pool scheduling/prefetch tied to playhead velocity;
5. real proxy/thumbnail generation into derived storage;
6. WebGPU texture/effect kernels;
7. offline audio automation and encoding;
8. video/audio encoder adapters and actual MP4/WebM mux writers;
9. WASM/native fallbacks for codec/container gaps.
