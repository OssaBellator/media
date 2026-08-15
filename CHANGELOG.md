# Changelog

## 0.14.0

- Integrated frame-budget fidelity into the normal Cut composition-preview path instead of leaving it as an isolated scheduling adapter.
- Added `CompositionPlaybackEngine.presentEvaluated()` so Cut evaluates the graph once and renders the same evaluated composition through the fidelity loop.
- Added adaptive preview-resolution scaling driven by EWMA render cost and recent stale-frame pressure; scrubbing drops immediately to a cheaper preview while export remains full resolution.
- Added an explicit Cut fidelity adapter that resolves FPS from evaluated composition identity and passes fidelity metadata through Canvas2D/WebGPU composition render calls.
- Added abortable scrub generations so newer interactive seeks cancel stale decode/render work without treating cancellation as a failed or presented frame.
- Added separate presented/stale/failed/cancelled playback metrics and controller reset semantics so errors or old compositions do not poison future fidelity decisions.
- Added focused 0.14 playback regressions while preserving the existing 0.09 composition and 0.13 fidelity behavior.

## 0.13.0

- Added a modular 188-byte MPEG-TS demux/session path with PAT/PMT discovery, PES reconstruction, continuity/PCR diagnostics and 33-bit timestamp rollover handling.
- Added H.264/H.265 Annex-B keyframe inspection, H.264 SPS dimensions/codec metadata and AAC/ADTS access-unit extraction.
- Added adaptive byte-signature routing between existing CMAF sessions and bounded MPEG-TS sessions for legacy HLS packaging.
- Added a v2 DASH period/timing layer with inferred period windows, period-unique representation IDs, UTCTiming, ServiceDescription, EventStream and availability metadata.
- Added a period-aware DASH browser session with clock synchronization and representation-family preference across period transitions.
- Added SHA-256 integrity verification, host-version bounds and redirect-origin checks for codec plugins plus an integrity-required production runtime entry point.
- Added WebCodecs per-chunk payload decoding for non-contiguous elementary-stream payloads.
- Added frame-budget fidelity scheduling plus an additive playback adapter that resolves FPS from evaluated composition identity.
- Added focused 0.13 regressions across transport streams, adaptive routing, DASH clocks/periods, codec integrity, payload decode and fidelity control.

## 0.12.0

- Added normalized HLS master/media parsing including LL-HLS parts/server-control/preload hints, delta `EXT-X-SKIP`, rendition reports, byte ranges, maps, discontinuities and key metadata.
- Added DASH `SegmentTemplate`/`SegmentTimeline`, dynamic availability windows, `SegmentList` and `SegmentBase` normalization.
- Added ISO-BMFF `sidx` parsing plus bounded hierarchical sub-index expansion and DASH range hydration.
- Added adaptive ABR/session state, retry/backoff, duplicate-delivery suppression, VOD variant switching and an adaptive CMAF bridge.
- Added explicit unsupported MPEG-TS handling and injected AES-128 HLS segment decryption boundary.
- Added validated `media.codec.v1` codec plugin modules, trusted-origin browser loading and plugin registration in the codec router.
- Added normalized display/HDR output policy and a GPU renderer factory driven by that policy.
- Added temporal shutter/rolling-shutter sampling, temporal GPU graph expansion and CPU accumulation reference kernels.
- Added signed-distance vector matte reference rasterization with feathered alpha output.
- Added configurable MP4 chunk/table scale planning plus `npm run stress` for long export/adaptive/matte workloads.
- Added environment-keyed conformance history and long-run regression budgets via `npm run conformance:history`.
- Added focused 0.12 regressions across adaptive manifests/sessions, CMAF bridging, codec plugins, display policy, sidx, motion/vector reference kernels and MP4 scale.

## 0.11.0

- Added append-only range sources with backpressure, wait-for-size, pruning and ReadableStream pumping.
- Added resumable HTTP byte transport plus bounded live WebM and CMAF session primitives.
- Added CENC inspection for protected sample entries, track/sample-group encryption, IV/subsample metadata, auxiliary-info tables and PSSH initialization data without bundling decryption.
- Added typed encrypted-media failures plus an injected exact-sample decryptor boundary shared by Cut and range-driven offline audio.
- Added a streaming fast-start classic MP4 writer/finalizer that emits sample payloads directly to a sink instead of rebuilding the final file in memory.
- Added lazy IndexedDB checkpoint range sources so resumable render segments are loaded only when the finalizer touches their byte ranges.
- Preserved signed composition offsets, leading track delays, codec descriptions, rotation, pixel aspect and color/HDR metadata through streaming finalization.
- Reduced classic MP4 chunk-table growth by grouping consecutive same-track payload runs.
- Added luma/alpha feather masks, explicit linear RGBA16 native/WASM ingest and mandatory tone-map policy for linear HDR presentation.
- Added codec backend health/quarantine tracking and percentile/baseline conformance performance reports.
- Added strict external-corpus mode plus 0.11 regressions for live transport, protected media, lazy/streaming finalization, HDR ingest and backend health.

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
