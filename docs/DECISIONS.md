# Engineering decisions

## ADR-001 — Project graph over application files

Canvas, Cut, Motion, Deliver and Agent share one graph instead of separate file formats.

## ADR-002 — Operations are the durable mutation boundary

UI gestures and agent plans emit the same small operation vocabulary. High-level editing helpers return operations rather than mutating graph state.

## ADR-003 — Validate semantics after atomic batches

Intermediate operations may temporarily create incomplete relationships. Schema/application errors are diagnosed per operation; semantic invariants are enforced on the completed batch.

## ADR-004 — Keep source bytes outside the graph

The graph stores logical locators and metadata. Large blobs live behind storage adapters. Runtime object URLs are transient.

## ADR-005 — AI providers do not receive privileged mutation access

Provider output is validated operation data. Remote planner snapshots omit local source URIs and heavyweight derived media.

## ADR-006 — Browser-first does not mean browser-locked

Core modules contain no DOM/IndexedDB/WebGPU dependencies. Browser runtime adapters can later be replaced by native/WASM/cloud implementations.

## ADR-007 — Do not pretend WebCodecs demux exists

Container demux is a separate requirement. Browser media elements remain a decode fallback until an actual demux/chunk pipeline is implemented.

## ADR-008 — Outputs are project data

Deliver presets/settings are graph nodes so output intent is versioned, inspectable and compatible with render caching/distribution.

## ADR-009 — Memory/cache behavior is explicit

Decoded media uses weighted budgets and scheduled work rather than implicit unbounded browser caches.

## ADR-010 — Text and vector shapes stay native

Typography and basic graphics remain editable graph objects. They share transforms, animation and effects and are only rasterized by a renderer when needed.

## ADR-011 — Project files carry source manifests, not embedded media

Version 2 promotes source metadata/fingerprints to a formal top-level manifest to support relinking and packaging without coupling project validity to source availability.
