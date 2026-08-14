# Changelog

## 0.8.0

- Integrated a Worker-pool/WebCodecs Cut playback service with timeline-driven active-clip/source-time resolution and HTML-media fallback.
- Added compact encoded decode windows so Workers receive only the byte ranges needed for a seek/prefetch operation.
- Added streamed `VideoFrame`/`AudioData` kernel progress delivery and transferable progress messages instead of retaining whole decode batches.
- Added fingerprint-aware decoded-frame cache invalidation and a bounded playback frame cache.
- Added keyframe-aligned derivative segment jobs with claims, retries, recovery, progress and IndexedDB-backed resumability.
- Added compact per-segment proxy source windows and Studio build/resume proxy integration.
- Added full Deliver timeline render → WebCodecs encode → MP4/WebM mux orchestration with optional offline audio.
- Added byte-sink abstractions plus progressive fragmented-MP4 and unknown-size WebM streaming writers.
- Added progressive video export that can release encoded video chunks after sink delivery instead of retaining the complete stream.
- Added HEVC (`hvc1`/`hev1`) and AV1 (`av01`) MP4 sample-entry/configuration output.
- Added MP4 `colr/nclx`, `pasp`, `clli`, `mdcv` and rotation-matrix writing plus demux-side metadata extraction.
- Added preservation of color/HDR/aspect/rotation metadata through the encoded-stream → mux bridge.
- Added a byte-bounded LRU WebGPU frame texture cache and a WGSL effect pipeline for brightness, contrast, saturation, hue, blur and opacity, with Canvas2D fallback.
- Added sample-domain audio automation curves and graph operation helpers for clip/output gain/pan automation.
- Added automated offline mix rendering, fixed source-in conversion across differing source/output sample rates, and PCM block generation.
- Added BS.1770-style K-weighted/gated integrated loudness, surround channel weighting, windowed-sinc intersample peak estimation and loudness/peak-constrained normalization.
- Added Studio Deliver actions for MP4/WebM render, progressive file streaming where File System Access is available, loudness analysis and resumable proxy generation.
- Added 43 focused local 0.8 regression tests across playback, streaming codecs/sinks, derivatives, MP4 metadata, GPU effects and offline audio.

## 0.7.0

- Added an in-memory classic fast-start MP4/MOV writer for AVC + AAC.
- Added fragmented-MP4 init/media writers using `mvex/trex`, `tfhd`, `tfdt` and `trun`.
- Added `edts/elst` v0/v1 parsing and simple 1× edit-list application during MP4 demux.
- Added leading-empty-edit emission when classic mux tracks begin after movie time zero.
- Added version-1 `mdhd` output for long-form tracks that exceed 32-bit microsecond duration.
- Added direct WebCodecs encoder-result → mux-plan bridging with decoder-description preservation.
- Added executable thumbnail generation through keyframe-safe WebCodecs decode + canvas encoding.
- Added executable WebM proxy transcoding with resize, VP9/AV1 video, optional Opus audio and explicit batch-memory caps.
- Added real kernel `thumbnail`, `proxy`, MP4/MOV `mux` and fMP4 mux dispatch paths.
- Fixed seek-window overlap so a chunk ending exactly at a keyframe boundary is not included before that keyframe.

## 0.6.0

- Added classic/fMP4 and WebM demux, WebCodecs codec adapters, Worker scheduling and in-memory WebM output.

## 0.5.0

- Added the versioned media-kernel protocol/runtime, WAV decode, structural container parsing, offline PCM primitives, derivative planning, resumable render jobs and the production pipeline DAG.

## 0.4.0

- Added decoded-frame cache/scheduler, audio clip semantics, Deliver output nodes/manifests, project-file v2, derived storage and native text/vector layers.

## 0.3.0

- Added semantic invariants, Canvas transforms, Motion keyframes/effects, advanced timeline semantics, frame transport, source fingerprints/relinking and planner-provider contracts.

## 0.2.0

- Added durable IndexedDB projects/media, versioned project files and core timeline editing.

## 0.1.0

- Initial Universal Creative Graph and dependency-light Studio alpha.
