# Roadmap

## Landed through 0.16

- normalized HLS/LL-HLS and DASH adaptive manifest models;
- DASH dynamic windows, SegmentList, SegmentBase and hierarchical `sidx` range hydration;
- DASH v2 multi-period switching, event streams, `UTCTiming`, service-description latency, availability-time-offset gating and low-latency chunk callbacks;
- deterministic ABR/retry/dedup and adaptive CMAF session bridges;
- 188-byte MPEG-TS ingest for legacy HLS with PAT/PMT, PES, timestamp unwrap, H.264/H.265 access units and AAC/ADTS reframing;
- trusted `media.codec.v1` plugin backends and async production kernel startup;
- display/HDR output policy applied at GPU renderer construction;
- temporal shutter/rolling-shutter sampling and CPU/GPU accumulation contracts;
- vector matte signed-distance/feather reference rasterization;
- MP4 scale projection, stress command and longitudinal conformance history;
- Cut and composition-delivery runtime sessions with direct in-memory graph ownership in Studio;
- deterministic checksummed operation-log primitives plus atomic IndexedDB graph/journal checkpoints and recovery validation;
- serialized Studio `ProjectJournalSession` plus `HistoryJournalSession`, now wired into `app.js` for persistence-first edit/Agent/undo/redo/import/project-open recovery.

## Next hardening

1. feed emitted low-latency CMAF fragment units directly into incremental demux/decode instead of stopping at the acquisition/fragment boundary;
2. integrate temporal motion blur/vector mattes into normal Cut GPU scheduling rather than reference-only paths;
3. platform color management, display calibration and actual HDR swap-chain/output surfaces;
4. signed/integrity-pinned codec plugin packaging and real native/WASM codec distributions;
5. larger encrypted/adaptive real-media corpus plus HLS/DASH live lab fixtures;
6. integrate MP4 chunk planning directly into final writer interleave policy and stress multi-day outputs;
7. make asset Blob import/relink atomic with graph+journal checkpoints, then add authenticated collaboration and distributed render execution.
