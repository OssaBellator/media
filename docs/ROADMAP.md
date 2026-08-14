# Roadmap

## 0.10 — production boundary closure

- sparse common fMP4 indexing;
- append-aware unknown-size WebM Cluster indexing;
- range-driven compressed offline audio;
- richer GPU blend/mask/transition/intrinsic graph;
- float working targets and explicit HDR tone mapping;
- resumable fMP4 → classic MP4 finalization;
- codec backend portability contract;
- deterministic + external real-media conformance harness.

## Next hardening

1. broader fragmented-MP4 features: encryption/sample groups, complex base offsets and multi-description fragments;
2. true streaming/network source lifecycle for live WebM/CMAF;
3. guaranteed scene-linear HDR upload path and display calibration metadata;
4. feather/vector masks, track mattes and richer transition/effect graphs;
5. seekable classic MP4 writer that does not retain the final payload in memory;
6. ship/benchmark real native or WASM codec backends in downstream targets;
7. grow the real-media corpus across browsers, GPUs, cameras and operating systems;
8. collaborative operation-log/history architecture and production render distribution.
