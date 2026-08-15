# Media

Media is an experimental unified creative workstation for image, video, audio, animation and emerging media.

The architectural thesis remains: **the creative project is the product, not a collection of application-specific files**. Canvas, Cut, Motion, Deliver and Agent are views over one Universal Creative Graph, reversible history and a shared media-kernel contract.

## Current milestone — 0.13

0.13 extends the 0.12 adaptive/runtime boundary into **legacy HLS transport, period-correct DASH timing, integrity-pinned codec plugins and adaptive render fidelity** while keeping the large 0.12 parser/playback/kernel modules intact.

### Legacy HLS / MPEG-TS

A new v2 container contract and MPEG-TS kernel cover common 188-byte transport streams:

- transport sync, adaptation fields, PCR and continuity diagnostics;
- PAT/PMT program and elementary-stream discovery;
- PES reconstruction across TS packets;
- 33-bit PTS/DTS unwrapping across segments plus explicit discontinuity reset;
- H.264/H.265 Annex-B keyframe inspection;
- H.264 SPS dimensions and concrete RFC6381-style AVC codec strings;
- AAC/ADTS access-unit extraction with AudioSpecificConfig;
- bounded `MpegTsSegmentSession` acknowledgement/eviction.

`AdaptiveMediaSession` routes fetched bytes by signature into either the existing CMAF session or the MPEG-TS session. HLS whole-segment AES-128 still clears before container parsing. TS transport scrambling is a separate protected-media condition and fails explicitly.

### DASH timing / periods

`dash-v2.js` adds period-correct `SegmentTemplate` expansion without replacing the broader 0.12 DASH parser. It provides:

- inferred period windows from neighboring period starts/MPD duration;
- period-unique representation IDs even when representation IDs repeat;
- `UTCTiming` direct / HTTP HEAD / HTTP xsdate/ISO synchronization;
- ServiceDescription latency/playback-rate metadata;
- EventStream timing;
- `availabilityTimeOffset` / `availabilityTimeComplete` metadata;
- active-period/variant/segment selection across sequence-number restarts.

`DashStreamSessionV2` synchronizes its clock before dynamic expansion and keeps representation-family preference across period transitions.

### Codec plugin deployment

Production codec plugins can be integrity-pinned with SHA-256 SRI or hex digests. The secure loader hashes the **fetched bytes that are actually imported**, rechecks redirect origins, validates optional host-version bounds and requires integrity by default in `createSecureProductionKernelRuntime()`.

Integrity-pinned browser plugins are expected to be single-file ESM bundles. Media does not yet verify arbitrary relative-import module graphs as one signed package.

### Adaptive fidelity

`FidelityController` turns temporal/vector reference work into a frame-budget policy:

- scrubbing collapses to one temporal sample and one matte sample;
- playback adapts temporal samples and matte supersampling from measured render cost/staleness;
- export preserves requested reference quality;
- FPS resolution follows the evaluated composition ID, so it does not depend on a graph `kind` marker.

`FidelityPlaybackEngine` is an additive scheduling adapter: it evaluates a composition, attaches the fidelity plan to a render callback and feeds measured outcomes back into the controller. Existing 0.12 composition playback remains a compatible fallback.

### Non-contiguous decoder payloads

`decodePayloadChunks()` lets WebCodecs consume per-chunk elementary payloads directly. MPEG-TS therefore does not need fake source offsets or a reconstructed file-sized elementary stream before decode.

## Deliberate 0.13 boundaries

The TS reference path targets 188-byte MPEG-TS, not 192-byte M2TS. H.264 metadata is deeper than HEVC metadata. AAC/ADTS is reframed; LATM, MP3, AC-3 and E-AC-3 are currently identified at the program level rather than all being normalized into decoder-ready access units. DASH v2 concentrates on period/timing `SegmentTemplate` behavior while the 0.12 parser remains the broader `SegmentList`/`SegmentBase`/`sidx` path. Media still does not ship DRM/key acquisition, native/WASM codec binaries, calibrated OS HDR output or a large copyrighted device corpus.

## Run locally

```sh
npm run dev
npm test
npm run syntax:check
npm run build
npm run check
npm run conformance
npm run stress
```

## Engineering principle

The UI is not the source of truth. Gestures, agents, Workers, adaptive manifests, range/segment sources, codec/decryptor/plugin backends, GPU passes, derivative jobs and resumable render checkpoints converge on the same graph/evaluation/kernel contracts.

See `docs/ARCHITECTURE.md`, `docs/ENGINE.md`, `docs/KERNEL.md`, `docs/SOURCE_IO.md`, `docs/LIVE_MEDIA.md`, `docs/ADAPTIVE_STREAMING.md`, `docs/MPEG_TS.md`, `docs/PLAYBACK.md`, `docs/EXPORT.md`, `docs/GPU.md`, `docs/MOTION_RENDERING.md`, `docs/AUDIO.md`, `docs/CODECS.md`, `docs/CONFORMANCE.md`, `docs/STRESS.md`, `docs/PROJECT_FORMAT.md`, `docs/DECISIONS.md` and `docs/ROADMAP.md`.
