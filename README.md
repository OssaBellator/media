# Media

Media is an experimental unified creative workstation for image, video, audio, animation and emerging media.

The architectural thesis remains: **the creative project is the product, not a collection of application-specific files**. Canvas, Cut, Motion, Deliver and Agent are views over one Universal Creative Graph, reversible history and a shared media-kernel contract.

## Current milestone — 0.11

0.11 hardens the 0.10 production architecture around long-running, live, protected and high-dynamic-range media instead of adding another workspace.

### Live and bounded media IO

- classic MP4/MOV, common fragmented MP4 and WebM remain sparse/range indexed;
- append-only sources expose an absolute byte address space, backpressure, wait-for-size and explicit pruning;
- HTTP live transport resumes with byte ranges and rejects servers that would duplicate an already-received stream;
- live WebM combines the append source with incremental unknown-size Cluster indexing;
- CMAF segments can be indexed independently and acknowledged/evicted without retaining one ever-growing source buffer.

### Protected-media inspection without hidden DRM behavior

- fragmented MP4 inspection understands `encv`/`enca`, `sinf`, `schm`, `tenc`, `senc`, `saiz`, `saio`, `sgpd(seig)`, `sbgp` and `pssh` metadata;
- default and sample-group KIDs, IVs, pattern-encryption state and subsample maps are exposed to the media kernel;
- protected samples fail with typed `ERR_ENCRYPTED_MEDIA` before codec submission unless an authorized decryptor is explicitly injected;
- the decryptor contract operates on exact selected sample ranges and returns clear bytes; Media does not ship key acquisition, DRM policy or decryption algorithms.

### Streaming classic MP4 finalization

A completed resumable render no longer needs to be materialized into memory before distribution:

```text
IndexedDB render checkpoints
  -> lazy composite range source
  -> sparse fMP4 sample index
  -> fast-start moov/co64 tables
  -> one-sample-at-a-time payload reads
  -> output byte sink
```

The writer preserves signed composition offsets, delayed track starts through `edts/elst`, codec descriptions, rotation, pixel aspect, nclx color and CLLI/MDCV HDR metadata. Consecutive same-track samples share MP4 chunk-table entries rather than forcing one `co64` record per sample.

### GPU/HDR fidelity

- masks can use alpha or luma semantics and a feather radius;
- composition keeps `rgba16float` intermediate targets and destination-sampled blend modes;
- native/WASM backends may inject explicitly linear RGBA16 frames into a half-float texture path;
- linear HDR frames require an explicit tone-map policy before presentation; ordinary browser `VideoFrame` upload remains a separate browser-managed path rather than being described as guaranteed scene-linear HDR.

### Codec and conformance health

- codec backends retain conservative unsupported-only fallback and now track failures, successes and temporary quarantine state;
- `npm run conformance` can emit JSON performance reports and compare p50/p95/p99 metrics against a baseline;
- `MEDIA_REQUIRE_CORPUS=1` makes missing external fixtures fail the run instead of remaining optional skips;
- large camera/device fixtures remain out of tree under `MEDIA_CORPUS_DIR`.

## Deliberate 0.11 boundaries

Media still does not bundle DRM/key systems, native codec binaries, WASM codec binaries or a large copyrighted camera corpus. CENC support is metadata plus an injected clear-sample boundary, not decryption. The live HTTP helper is byte transport, not a DASH/HLS manifest client. HDR display calibration/OS output control remains outside the browser reference path. Complex vector mattes and spatially varying feather kernels still need a deeper GPU graph. Real shipping confidence still depends on downstream native backends and a much larger cross-device corpus.

## Run locally

```sh
npm run dev
npm test
npm run syntax:check
npm run build
npm run check
npm run conformance
```

Optional conformance controls:

```sh
MEDIA_CORPUS_DIR=/path/to/media-corpus npm run conformance
MEDIA_CONFORMANCE_REPORT=artifacts/report.json npm run conformance
MEDIA_CONFORMANCE_BASELINE=baseline.json MEDIA_MAX_REGRESSION=.10 npm run conformance
MEDIA_REQUIRE_CORPUS=1 MEDIA_CORPUS_DIR=/path/to/full-corpus npm run conformance
```

## Engineering principle

The UI is not the source of truth. Gestures, agents, Workers, range sources, codec/decryptor backends, GPU passes, derivative jobs and resumable render checkpoints converge on the same graph/evaluation/kernel contracts.

See `docs/ARCHITECTURE.md`, `docs/ENGINE.md`, `docs/KERNEL.md`, `docs/SOURCE_IO.md`, `docs/LIVE_MEDIA.md`, `docs/PLAYBACK.md`, `docs/EXPORT.md`, `docs/GPU.md`, `docs/AUDIO.md`, `docs/CODECS.md`, `docs/CONFORMANCE.md`, `docs/PROJECT_FORMAT.md`, `docs/DECISIONS.md` and `docs/ROADMAP.md`.
