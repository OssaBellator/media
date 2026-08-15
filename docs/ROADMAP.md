# Roadmap

## Landed through 0.16

- normalized HLS/LL-HLS and DASH adaptive manifest models;
- DASH dynamic windows, SegmentList, SegmentBase and hierarchical `sidx` range hydration;
- DASH v2 multi-period switching, event streams, `UTCTiming`, service-description latency, availability-time-offset gating and low-latency chunk callbacks;
- deterministic ABR/retry/dedup and adaptive CMAF session bridges;
- low-latency DASH CMAF fragment handoff that demuxes/indexes emitted `moof` + `mdat` units immediately per variant without double-processing the later whole HTTP segment;
- persistent per-variant/per-track WebCodecs submission from incrementally indexed CMAF fragments, with queue backpressure, init-reset handling and encrypted-sample rejection;
- bounded decoded video/audio live queues plus playhead-driven presentation scheduling and representation-switch cleanup;
- browser live output that reuses the Cut kernel canvas and schedules decoded AudioData on an AudioContext clock with late-sample offsets and drift correction;
- DASH video routing through the normal Cut composition frame-provider seam, preserving clip source-time, transforms, masks, effects, temporal rendering and GPU/Canvas composition while leaving ordinary file assets on the existing kernel provider;
- explicit Cut scrub/playback mode propagation into adaptive frame requests, forcing decoder flushes for scrubs while keeping continuous DASH playback streaming after bootstrap;
- muxed DASH visual-clip audio routed by default into a Cut-owned browser audio scheduler, with relink/invalidation reset and composition-lifecycle cleanup;
- deterministic live-latency conformance telemetry covering live-edge/target distance plus fragment→submit→decode→output stage distributions and opt-in budgets;
- 188-byte MPEG-TS ingest for legacy HLS with PAT/PMT, PES, timestamp unwrap, H.264/H.265 access units and AAC/ADTS reframing;
- `media.codec.v1` remote plugin loading restored to verified-byte execution with SRI/hex SHA-256 pins, redirect-origin and host-version checks, optional canonical-statement signatures, and deterministic package descriptor generation;
- display/HDR output policy applied at GPU renderer construction;
- temporal shutter/rolling-shutter sampling and CPU/GPU accumulation contracts;
- Cut temporal motion blur scheduled on WebGPU with pre-final linear `rgba16float` working-texture accumulation, per-sample vector-mask adaptation, one post-accumulation HDR tone-map pass and deterministic Canvas fallback;
- vector matte signed-distance/feather reference rasterization;
- MP4 scale projection, bounded per-track chunk planning wired into streaming final-writer interleave/`stsc`/`co64` layout, explicit three-day stress projection and longitudinal conformance history;
- Studio brand/version badge sourced from the application version instead of a legacy hardcoded `0.4`;
- Cut and composition-delivery runtime sessions with direct in-memory graph ownership in Studio;
- deterministic checksummed operation-log primitives plus atomic IndexedDB graph/journal checkpoints and recovery validation;
- authenticated collaboration operation batches binding actor/key identity, canonical transaction bytes and the exact prior log head, with allowlist/freshness policy and fail-closed pre-replay verification;
- deterministic causal conflict classification for stale collaboration batches, including property-level shallow node conflicts, edge/link conflicts, conservative unknown-operation handling and explicit re-sign requirements for safe rebases;
- authenticated render-worker claim/completion messages binding actor/key identity to exact chunk attempts and signed SHA-256 artifact descriptors, with injected artifact verification and ownership metadata cleared on retry/recovery;
- shared `media.trust-registry.v1` actor/key lifecycle with purpose-scoped enrollment, validity/revocation, persistence-first nonce consumption and domain-bound collaboration/render verifier adapters;
- dedicated Studio trust IndexedDB persistence with registry revision compare-and-swap and replay state surviving reload while failing closed without durable storage;
- atomic trusted-transition session for serialized signature/replay verification plus application-state commit, ensuring transition/persistence failures publish neither replay nor project/job state;
- transport-independent collaboration coordinator session that atomically commits authenticated current batches with graph/log/replay state and returns deterministic stale/conflict classifications without rewriting signed history;
- serialized Studio `ProjectJournalSession` plus `HistoryJournalSession`, wired into `app.js` for persistence-first edit/Agent/undo/redo/import/project-open recovery;
- media import/relink Blob writes committed atomically with their graph+journal checkpoint through one IndexedDB transaction;
- automatic compare-and-swap journal compaction in `HistoryJournalSession` at a 250-entry threshold while preserving the in-memory undo stack;
- undo-aware quota-pressure source-Blob cleanup in `HistoryJournalSession`, targeting 90% → 80% usage while retaining persisted and present/past/future asset identities plus fingerprint aliases;
- observer-free advanced runtime controls with a persistent event-delegated panel and an explicit graph-provider handoff seam;
- cache-first shared Studio graph state for advanced actions, eliminating repeated IndexedDB graph reloads after bootstrap while preserving the graph-provider override seam.

## Next hardening

1. run the latency tracker against real live-media/browser lab fixtures and expand encrypted/adaptive HLS/DASH coverage;
2. platform color management, display calibration and actual HDR swap-chain/output surfaces;
3. ship real signed native/WASM codec distributions and deployment key-management policy on top of the verified package format;
4. larger encrypted/adaptive real-media corpus plus HLS/DASH live lab fixtures;
5. add bounded authenticated collaboration HTTP/WebSocket transport plus resolution UI and administrative enrollment/account authorization; add remote render coordinator/artifact-storage transport on the existing atomic trust/application transition boundary.
