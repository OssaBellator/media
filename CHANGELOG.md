# Changelog

## 0.10.0

- Added sparse fragmented-MP4 range indexing for common CMAF/default-base-is-moof files without materializing `mdat` payloads.
- Added append-aware live/unknown-size WebM Cluster indexing with partial-tail recovery and frame deduplication.
- Added range-driven compressed-audio decode into sparse planar PCM and integrated it into offline Deliver audio with whole-Blob fallback.
- Added compositing semantics for blend modes, alpha masks and timeline transitions to evaluated render plans.
- Added a WebGPU render graph with intrinsic text/shape raster inputs, alpha masks, crossfade/wipes/dip transitions and destination-sampled blend modes.
- Added `rgba16float` working composition targets plus PQ/HLG transfer helpers and explicit tone-map policies.
- Added virtual composite range sources and fMP4 checkpoint → classic fast-start MP4 finalization.
- Added ranked codec backend routing for injected native, WebCodecs and injected WASM implementations with explicit unsupported-only fallback.
- Added a conformance corpus manifest/runner with deterministic built-in coverage, optional real-media fixtures and index/read/decode budgets.
- Added 0.10 focused regressions across fragmented/live containers, compressed audio, GPU/compositing/HDR, finalization, codec routing and corpus semantics.

## 0.9.0

- Added range-addressable source IO, sparse classic MP4/WebM indexing, composition-aware Cut playback, streaming proxy transcode, resumable fMP4 delivery, GPU composition/color policy and performance counters.

## 0.8.0

- Integrated Worker/WebCodecs playback, streamed decode results, resumable proxies, progressive delivery, MP4 presentation metadata, GPU effects and offline loudness automation.

## 0.7.0

- Added classic/fMP4 writing, edit-list handling, encoder→mux bridging and executable thumbnail/proxy derivatives.

## 0.6.0

- Added classic/fMP4 and WebM demux, WebCodecs adapters, Worker scheduling and WebM output.

## 0.5.0

- Added the versioned media-kernel runtime, media primitives, derivative planning, resumable render jobs and production pipeline DAG.

## 0.4.0

- Added Deliver, audio/runtime foundations, editable text/vector layers, project format v2 and persistent source identity.
