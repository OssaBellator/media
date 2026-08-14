# Changelog

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
