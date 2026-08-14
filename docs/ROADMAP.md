# Roadmap

## 0.11 — production depth

- CENC/PSSH/sample-group inspection and typed protected-media boundaries;
- injected exact-sample decryptor contract without bundled DRM/key acquisition;
- append-only source backpressure/pruning and resumable HTTP byte transport;
- live WebM and bounded CMAF session primitives;
- lazy checkpoint storage reads;
- streaming fast-start classic MP4 finalization with presentation metadata preservation;
- feathered alpha/luma masks and explicit linear RGBA16 HDR ingest;
- codec backend health/quarantine;
- percentile/baseline conformance reporting and strict corpus mode.

## Next hardening

1. broader CENC auxiliary-data addressing and encrypted real-media corpus coverage;
2. DASH/HLS/WebTransport adapters above the live byte/session contracts;
3. production platform color management, display calibration and HDR output surfaces;
4. vector/path masks, track mattes, motion blur and higher-quality multi-pass feather/blur kernels;
5. larger classic-MP4 table stress tests and configurable interleave/chunk duration policy;
6. ship and benchmark real native/WASM codec backends in downstream targets;
7. expand camera/device/browser/GPU conformance fixtures and retain longitudinal performance baselines;
8. crash-safe persistent operation log, collaboration and distributed render execution.
