# Engineering decisions

## ADR-001 — Project graph over application files

Canvas, Cut, Motion and Agent share one graph rather than owning separate file formats.

## ADR-002 — Operations are the durable mutation boundary

UI gestures and agent plans emit the same small operation vocabulary. High-level editing helpers return operations rather than mutating graph state.

## ADR-003 — Validate semantics after atomic batches

Individual intermediate operations may temporarily create an incomplete relationship (for example adding a clip before adding its reference edge). Semantic invariants are therefore enforced on the completed batch, while schema/application failures still identify their operation index.

## ADR-004 — Keep source blobs outside the project graph

The graph stores stable locators and metadata. Large blobs live in a storage adapter. Runtime object URLs are transient.

## ADR-005 — AI providers do not receive privileged mutation access

Provider output must be a validated operation plan. Arbitrary provider output is rejected before it reaches project state.

## ADR-006 — Browser-first does not mean browser-locked

The core contains no DOM/IndexedDB/WebGPU dependencies. Media/runtime adapters live under the Studio application so native/WASM implementations can replace them later.

## ADR-007 — Do not pretend WebCodecs demux exists

WebCodecs support is capability-detected, but container demux is not yet implemented. Browser media elements remain the decode fallback until a real demux/decode pipeline exists.
