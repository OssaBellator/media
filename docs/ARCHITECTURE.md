# Architecture

## Product invariant

Media has one canonical project representation. Interfaces such as Canvas, Cut, Motion, Mix and Agent are projections over that representation rather than separate document formats.

## Universal Creative Graph

The graph currently contains nodes and edges.

### Node families

- `project` — graph root and project-level metadata;
- `asset` — source or generated media;
- `composition` — spatial/temporal output context;
- `track` — ordered temporal lane;
- `clip` — a temporal use of an asset;
- `layer` — a spatial or semantic element;
- `effect` — a non-destructive transformation;
- `output` — a delivery target.

### Edge families

- `contains` — structural ownership or placement;
- `references` — non-owning use of another object;
- `derives-from` — provenance;
- `synchronizes` — temporal/semantic relationship;
- `targets` — operation/effect target.

An asset is therefore not “inside a Premiere sequence” or “inside a Photoshop document.” It is a graph object that can be referenced by many views and compositions.

## Mutation boundary

All planned automation uses declarative operations:

```js
{ type: "node.add", node }
{ type: "node.update", nodeId, patch }
{ type: "node.remove", nodeId }
{ type: "edge.add", edge }
{ type: "edge.remove", edgeId }
```

The initial planner is deterministic, but a model-backed planner should return the same operation language. Operations are validated before becoming project state.

This separation is important for safety and product quality: a model should not own persistence, rendering or arbitrary mutation APIs.

## History

The alpha stores graph snapshots for simple, reliable undo/redo. This is intentionally not the final representation. Once editing scale warrants it, history should migrate toward commands/event batches plus structural sharing or CRDT-compatible state.

The user-facing invariant should survive that change: agent edits and direct-manipulation edits participate in the same history.

## Media engine boundary

The current browser UI previews local media using native browser elements. It is not the eventual media engine.

Expected future layers:

```text
Studio views / interaction
        ↓
Creative Graph + operation protocol
        ↓
Evaluation / render graph
        ↓
Native + WASM + WebGPU media kernels
        ↓
Local GPU / optional render service
```

This allows the graph model to mature independently from codec, GPU and rendering implementation details.

## Model-provider boundary

A future model router should expose capabilities rather than vendor names to the rest of the product, for example:

- image.generate
- image.edit
- video.generate
- video.edit
- audio.generate
- speech.transcribe
- speech.synthesize
- project.plan

Provider-specific requests and credentials stay behind adapters. Project provenance should record which provider/model created or changed an object.

## Persistence

The current portable format is JSON with graph version `1`. Local `blob:` URLs are removed when exporting because they are session-scoped.

Near-term persistence work should add:

1. a project manifest;
2. content-addressed asset storage;
3. proxy/cache metadata;
4. schema migrations;
5. provenance and rights metadata;
6. optional collaborative operation logs.

## Why no framework yet

The first studio is built on browser primitives with no runtime dependencies. This is deliberate, not a claim that the final professional UI must remain framework-free.

The immediate architectural risk is getting the project/object model wrong. Keeping the shell small makes it inexpensive to replace while the graph contract remains stable. A future UI stack should be chosen based on timeline/canvas performance, plugin isolation, desktop packaging and collaboration needs rather than familiarity alone.
