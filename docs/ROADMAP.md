# Roadmap

## Landed through 0.16

- normalized HLS/LL-HLS and DASH adaptive manifest models;
- DASH dynamic windows, SegmentList, SegmentBase and hierarchical `sidx` range hydration;
- DASH v2 multi-period switching, event streams, `UTCTiming`, service-description latency, availability-time-offset gating and low-latency chunk callbacks;
- deterministic ABR/retry/dedup and adaptive CMAF session bridges;
- low-latency DASH CMAF fragment handoff that demuxes/indexes emitted `moof` + `mdat` units immediately per variant without double-processing the later whole HTTP segment;
- persistent per-variant/per-track WebCodecs submission from incrementally indexed CMAF fragments, with queue backpressure, init-reset handling and encrypted-sample rejection;
- bounded decoded video/audio live queues plus playhead-driven presentation scheduling and representation-switch cleanup;
- 188-byte MPEG-TS ingest for legacy HLS with PAT/PMT, PES, timestamp unwrap, H.264/H.265 access units and AAC/ADTS reframing;
- trusted `media.codec.v1` plugin backends and async production kernel startup;
- display/HDR output policy applied at GPU renderer construction;
- temporal shutter/rolling-shutter sampling and CPU/GPU accumulation contracts;
- vector matte signed-distance/feather reference rasterization;
- MP4 scale projection, stress command and longitudinal conformance history;
- Cut and composition-delivery runtime sessions with direct in-memory graph ownership in Studio;
- deterministic checksummed operation-log primitives plus atomic IndexedDB graph/journal checkpoints and recovery validation;
- serialized Studio `ProjectJournalSession` plus `HistoryJournalSession`, wired into `app.js` for persistence-first edit/Agent/undo/redo/import/project-open recovery;
- media import/relink Blob writes committed atomically with their graph+journal checkpoint through one IndexedDB transaction;
- automatic compare-and-swap journal compaction in `HistoryJournalSession` at a 250-entry threshold while preserving the in-memory undo stack;
- undo-aware quota-pressure source-Blob cleanup in `HistoryJournalSession`, targeting 90% → 80% usage while retaining persisted and present/past/future asset identities plus fingerprint aliases;
- observer-free advanced runtime controls with a persistent event-delegated panel and an explicit graph-provider handoff seam;
- cache-first shared Studio graph state for advanced actions, eliminating repeated IndexedDB graph reloads after bootstrap while preserving the graph-provider override seam.

## Next hardening

1. bind live DASH video presentation to the normal Cut canvas/GPU surface and AudioData scheduling to an AudioContext clock with drift correction;
2. integrate temporal motion blur/vector mattes into normal Cut GPU scheduling rather than reference-only paths;
3. platform color management, display calibration and actual HDR swap-chain/output surfaces;
4. signed/integrity-pinned codec plugin packaging and real native/WASM codec distributions;
5. larger encrypted/adaptive real-media corpus plus HLS/DASH live lab fixtures;
6. integrate MP4 chunk planning directly into final writer interleave policy and stress multi-day outputs;
7. replace the legacy visible `0.4` badge with the 0.16 app version, then begin authenticated collaboration and distributed render execution.
