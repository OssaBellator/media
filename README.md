# Media

Media is an experimental unified creative workstation for image, video, audio, animation and emerging media.

The architectural thesis remains: **the creative project is the product, not a collection of application-specific files**. Canvas, Cut, Motion, Deliver and Agent are views over one Universal Creative Graph, reversible history and a shared media-kernel contract.

## Current milestone — 0.12

0.12 turns the live/container/backend foundations from 0.11 into a more complete **adaptive and deployment-oriented media boundary**.

### Adaptive HLS / DASH acquisition

Media now normalizes HLS and DASH into one segment model above the existing range/container kernel:

- HLS master/media playlists, renditions, byte ranges, init maps, discontinuities, program date-time and key metadata;
- LL-HLS parts, server-control, preload hints, rendition reports and delta-playlist `EXT-X-SKIP` sequencing;
- DASH `SegmentTemplate` + `SegmentTimeline`, duration-based dynamic windows, `SegmentList`, `SegmentBase` and byte ranges;
- DASH `sidx` parsing, including bounded hierarchical reference expansion;
- ABR selection using conservative throughput estimates plus viewport/resolution caps;
- live-edge/hold-back positioning, retry/backoff and duplicate-delivery suppression;
- an adaptive → `CmafSegmentSession` bridge so fMP4/CMAF segments enter the same sparse indexing/acknowledgement path used elsewhere in Media.

MPEG-TS is rejected explicitly because the kernel still has no TS demuxer. HLS AES-128 segment encryption requires an injected `decryptSegment`; SAMPLE-AES/CENC metadata remains downstream protected-media work.

### Codec plugins

The browser codec router can now register validated `media.codec.v1` plugin backends in addition to injected native objects, WebCodecs and WASM objects. Plugin module loading is explicit and origin-restricted by default; an application has to opt into a trusted external module.

### Display/HDR output policy

A normalized display-capability model now chooses SDR vs HDR output policy, working format, output transfer/gamut and tone-map requirements. Browser CSS media queries can produce a conservative display profile, while platform/native targets can provide authoritative capabilities.

The policy is wired into a GPU renderer factory so HDR/SDR decisions configure the compositor's working format and tone-map state instead of living as detached metadata.

### Temporal and vector reference kernels

- shutter-angle temporal sample generation with box/triangle/cosine weights;
- rolling-shutter time offsets;
- temporal GPU render-graph expansion plus deterministic CPU weighted-frame accumulation;
- vector/path matte point-in-fill, signed-distance and feathered alpha rasterization.

These are correctness/reference kernels. Real-time multi-sample playback and a dedicated GPU path/vector-SDF rasterizer remain optimization work.

### Long-output / long-run hardening

- configurable MP4 chunk planning and table-size projection;
- multi-hour export scale validation without constructing millions of sample records;
- `npm run stress` for large adaptive-manifest parsing, MP4 table projection and vector-matte raster workloads;
- environment-keyed conformance history and long-run regression budgets via `npm run conformance:history`.

## Deliberate 0.12 boundaries

Media still does not bundle DRM/key acquisition, native/WASM codec binaries, MPEG-TS demux, HLS/DASH manifest networking policy for every extension, OS display calibration, or a large copyrighted camera corpus. DASH support targets common `SegmentTemplate`, `SegmentList` and `SegmentBase/sidx` delivery rather than the full standard surface. Browser HDR capability detection is advisory; calibrated HDR output still belongs in platform backends. Temporal motion blur and vector matte kernels are reference paths, not yet the normal real-time Cut renderer.

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

Optional conformance controls:

```sh
MEDIA_CORPUS_DIR=/path/to/media-corpus npm run conformance
MEDIA_CONFORMANCE_REPORT=artifacts/report.json npm run conformance
MEDIA_CONFORMANCE_BASELINE=baseline.json MEDIA_MAX_REGRESSION=.10 npm run conformance
MEDIA_REQUIRE_CORPUS=1 MEDIA_CORPUS_DIR=/path/to/full-corpus npm run conformance
MEDIA_CONFORMANCE_REPORT=artifacts/report.json npm run conformance:history
```

## Engineering principle

The UI is not the source of truth. Gestures, agents, Workers, adaptive manifests, range sources, codec/decryptor/plugin backends, GPU passes, derivative jobs and resumable render checkpoints converge on the same graph/evaluation/kernel contracts.

See `docs/ARCHITECTURE.md`, `docs/ENGINE.md`, `docs/KERNEL.md`, `docs/SOURCE_IO.md`, `docs/LIVE_MEDIA.md`, `docs/ADAPTIVE_STREAMING.md`, `docs/PLAYBACK.md`, `docs/EXPORT.md`, `docs/GPU.md`, `docs/MOTION_RENDERING.md`, `docs/AUDIO.md`, `docs/CODECS.md`, `docs/CONFORMANCE.md`, `docs/STRESS.md`, `docs/PROJECT_FORMAT.md`, `docs/DECISIONS.md` and `docs/ROADMAP.md`.
