# Roadmap

## 0.12 — adaptive/deployment hardening

- normalized HLS/LL-HLS and DASH adaptive manifest model;
- DASH dynamic windows, SegmentList, SegmentBase and hierarchical sidx range hydration;
- deterministic ABR/retry/dedup and adaptive CMAF session bridge;
- trusted `media.codec.v1` plugin backends and async production kernel startup;
- display/HDR output policy applied at GPU renderer construction;
- temporal shutter/rolling-shutter sampling and CPU/GPU accumulation contracts;
- vector matte signed-distance/feather reference rasterization;
- MP4 scale projection, stress command and longitudinal conformance history.

## Next hardening

1. MPEG-TS demux or an explicit downstream TS backend for legacy HLS;
2. wider DASH surfaces: multi-period switching, event streams, UTCTiming, availability-time-offset and low-latency chunk transfer;
3. integrate temporal motion blur/vector mattes into normal Cut GPU scheduling rather than reference-only paths;
4. platform color management, display calibration and actual HDR swap-chain/output surfaces;
5. signed/integrity-pinned codec plugin packaging and real native/WASM codec distributions;
6. larger encrypted/adaptive real-media corpus plus HLS/DASH live lab fixtures;
7. integrate MP4 chunk planning directly into final writer interleave policy and stress multi-day outputs;
8. crash-safe persistent operation log, collaboration and distributed render execution.
