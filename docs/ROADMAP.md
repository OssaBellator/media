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
- bounded deterministic `media.collaboration-wire.v1` batch-submit envelopes with UTF-8/JSON size limits, strict fields, transport-safe conflict diagnostics and current-head responses for client re-signing;
- Web `Request`/`Response` collaboration HTTP adapter with same-origin default, explicit bounded CORS preflight, pre-body authorization hook, streaming body ceiling and generic internal-error responses;
- runtime-neutral per-connection WebSocket adapter with bounded queued work, serialized coordinator submission/outbound sends, correlated backpressure, bounded wire reuse and explicit no-retry delivery semantics;
- bounded collaboration WebSocket client with pending-request backpressure, request-ID correlation, serialized outbound sends, no retry after ambiguous delivery and explicit unsolicited/duplicate response rejection;
- bounded collaboration HTTP client with strict wire-response validation, request correlation, typed errors, explicit no-retry semantics for ambiguous delivery and UI-oriented resolution action mapping;
- UI-safe collaboration conflict-resolution model that revalidates sanitized server coordinates against refreshed local history/original signed batches, exposes target/property summaries without patch values, de-duplicates rows and refuses automatic merge/re-sign;
- explicit conflict-resolution decision drafts grouped by remote operation, with head-bound fingerprints, complete-set enforcement and payload-free `keep-local`/`reapply-remote`/`manual` final intents;
- Studio conflict-resolution renderer, stateful session and delegated DOM controller that expose explicit decisions while owning no graph/signing/transport authority;
- fresh collaboration resolution-batch builder that accepts only finalized payload-free intent plus newly authored editor transactions, rejects head drift/reused IDs/invalid graph transitions and signs resolution provenance without copying stale remote operation payloads;
- atomic multi-job render-worker coordinator sharing one trust/replay registry, with claim/completion state and nonce consumption committed together and retryability preserved when no durable transition occurs;
- bounded `media.render-worker-wire.v1` envelopes plus listener-neutral HTTP adapter with strict fields/byte limits, pre-body authorization, same-origin/CORS policy and sanitized state/artifact errors;
- single-attempt render-worker HTTP client with strict correlated response validation and explicit unknown-delivery errors instead of automatic replay of signed worker messages;
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
5. bind collaboration resolution/session controls into the host Studio application and add host-specific WebSocket upgrade/session authorization plus administrative account/key lifecycle operations; deploy the render-worker coordinator with a durable atomic datastore, artifact upload/storage verification, scheduler/worker discovery and host HTTP/WebSocket listener/TLS integration.
