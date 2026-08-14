# Changelog

## 0.9.0

- Added a generic range-addressable media source contract with memory, Blob, HTTP Range and bounded paged-cache implementations.
- Added range-backed encoded-window compaction with adjacent-read coalescing and strict source bounds.
- Added sparse classic MP4/MOV top-level/moov indexing and exact absolute sample reads without materializing `mdat`.
- Added sparse WebM Info/Tracks/Cluster indexing that skips frame payloads and reads block/lacing prefixes only.
- Refactored Cut playback to consume range sources while preserving the legacy Blob resolver API.
- Fixed duplicate play/prefetch GOP work by deduplicating the actual encoded decode window.
- Added evaluated multi-layer composition playback with bounded preview scaling and latest-generation stale-frame suppression.
- Added a WebGPU multi-layer normal-blend compositor matching Canvas crop/anchor/transform/effect semantics, with separate GPU/Canvas surfaces and deterministic fallback.
- Added explicit SDR color-conversion primitives and an HDR GPU policy that refuses PQ/HLG in the default 8-bit cache without tone mapping.
- Added streaming decoder → scaler → encoder proxy handoff so resumable proxy segments no longer retain decoded-frame batches.
- Added resumable final fMP4 render jobs with concurrent per-chunk A/V encoding, global timestamps, retry-safe cancellation, persisted segments and deterministic assembly indexes.
- Added shared IndexedDB connection lifecycle, derived-prefix cleanup helpers and storage quota reporting.
- Added terminal WebM Cues to the streaming writer and corrected cluster timing for arbitrary `TimecodeScale`.
- Added conformance/performance counters and budgets for source-read amplification, cache hits, stale/dropped frames, media byte ranges and render chunk continuity.
- Added 0.9 focused regressions plus targeted 0.8 compatibility coverage for playback, GPU cache and derivative runner behavior.

## 0.8.0

- Integrated Worker/WebCodecs Cut playback, streamed decode results, resumable proxy segments and full Deliver timeline render.
- Added progressive fMP4/WebM sinks, HEVC/AV1 MP4 entries, color/HDR/aspect/rotation metadata, GPU texture/effect kernels and offline loudness automation.

## 0.7.0

- Added classic/fMP4 AVC/AAC writing, MP4 edit-list handling, WebCodecs encoder→mux bridging and executable thumbnail/proxy derivatives.

## 0.6.0

- Added classic/fMP4 and WebM demux, WebCodecs codec adapters, Worker scheduling and in-memory WebM output.

## 0.5.0

- Added the versioned media-kernel protocol/runtime, structural container parsing, offline PCM primitives, derivative planning, resumable render jobs and the production pipeline DAG.

## 0.4.0

- Added decoded-frame cache/scheduler, audio clip semantics, Deliver output nodes/manifests, project-file v2, derived storage and native text/vector layers.

## 0.3.0

- Added semantic invariants, Canvas transforms, Motion keyframes/effects, advanced timeline semantics, frame transport, source fingerprints/relinking and planner-provider contracts.

## 0.2.0

- Added durable IndexedDB projects/media, versioned project files and core timeline editing.

## 0.1.0

- Initial Universal Creative Graph and dependency-light Studio alpha.
