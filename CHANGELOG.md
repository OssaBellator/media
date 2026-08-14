# Changelog

## 0.6.0

- Added classic MP4/MOV sample-table demux for `stsd`, `stts`, `ctts`, `stsc`, `stsz`/`stz2`, `stco`/`co64` and `stss`.
- Added common fragmented-MP4 indexing for `trex`, `tfhd`, `tfdt` and `trun` samples.
- Added AVC decoder-description parsing and AAC AudioSpecificConfig extraction.
- Added WebM Tracks/Info/Cluster/Cues, SimpleBlock/BlockGroup and fixed/Xiph/EBML lacing demux.
- Added actual PCM/float WAV encoding and round-trip coverage.
- Added browser WebCodecs video/audio decode and encode adapters.
- Added priority Worker-pool scheduling, keyed task deduplication, cancellation and playhead prefetch planning.
- Fixed the kernel transfer boundary so Worker payload ArrayBuffers can be posted zero-copy without cloning away the transferred object.
- Added a recursive transferable collector for ArrayBuffers and browser media objects.
- Added an actual in-memory WebM writer for VP8/VP9/AV1 + Opus/Vorbis with keyframe Cues.
- Added end-to-end WebM mux → demux round-trip coverage.
- Added 33 focused local 0.6 regression tests across demux, codec adapters, workers and writers.

## 0.5.0

- Added a versioned media-kernel task protocol and cancellable handler runtime.
- Added Worker and inline browser kernel clients with transferable-result support.
- Added real RIFF/WAVE parsing and PCM/float WAV decoding.
- Added ISO-BMFF top-level box, `ftyp` and `mvhd` parsing foundations for MP4/MOV inspection.
- Added EBML variable-integer/element parsing and WebM DocType inspection.
- Added encoded-chunk descriptors, demux plans, decoder configs and keyframe-safe seek/prefetch indexes.
- Added mux track/sample plans, timestamp interleaving, keyframe-aligned segmentation and byte estimates.
- Added offline Float32 PCM resampling, gain/pan/fade mixing and normalization primitives.
- Added deterministic proxy/thumbnail/waveform derivative planning and cache keys.
- Added resumable frame-chunk render jobs with retry, interruption recovery and artifact manifests.
- Added a production pipeline DAG spanning source verification, derivatives, frame render, audio render, encode and mux stages.
- Added 82 new local delta tests covering the kernel/core and browser adapters.

## 0.4.0

- Added weighted decoded-frame cache and priority/deduplicating decode scheduler.
- Added audio gain/pan/fade semantics, mix planning and browser AudioContext preview mixing.
- Added Deliver output nodes, presets, deterministic render manifests and still-frame rendering.
- Added project-file v2 with formal source manifests and v1 migration.
- Added hash-indexed source relinking and derived-artifact IndexedDB storage.
- Added duplicate, roll, blade-all and ripple-trim timeline operations.
- Added sanitized HTTP planner-provider adapter.
- Added first-class editable text and native rectangle/ellipse layers.
- Expanded local test coverage to 69 tests.

## 0.3.0

- Added semantic project invariants, Canvas transforms, Motion keyframes/effects, advanced timeline semantics, frame transport, source fingerprints/relinking and planner-provider contracts.

## 0.2.0

- Added durable IndexedDB projects/media, versioned project files and core timeline editing.

## 0.1.0

- Initial Universal Creative Graph and dependency-light Studio alpha.
