# Architecture

## North-star architecture

Media treats a project as one graph that can be projected into specialized creative views rather than treating each view as a separate application/file format.

```text
                         ┌───────────────┐
                         │ Human / Agent │
                         └───────┬───────┘
                                 │ intent / gestures
                                 ▼
                       ┌───────────────────┐
                       │ Operation boundary │
                       │ schema + preflight │
                       └─────────┬─────────┘
                                 │ atomic edit
                                 ▼
                    ┌─────────────────────────┐
                    │ Universal Creative Graph │
                    └──────┬────────┬─────────┘
                           │        │
                 history ◄─┘        └─► semantic invariants
                           │
                           ▼
                    ┌───────────────┐
                    │ Evaluation     │
                    │ time + graph   │
                    └───────┬───────┘
                            │ render/audio plan
               ┌────────────┴────────────┐
               ▼                         ▼
        browser adapters          future native/WASM
      Canvas2D/WebGPU/audio       codecs/GPU/render farm
```

## 1. Universal Creative Graph

Graph node kinds currently include:

- `project`
- `asset`
- `composition`
- `track`
- `clip`
- `layer`
- `effect`
- `output`

Relationships are explicit edges (`contains`, `references`, `targets`, etc.). A clip references one shared asset; a Canvas layer can reference that same asset; neither needs to duplicate the media.

The low-level graph validator checks structural integrity. `invariants.js` adds domain rules such as clip/source ranges, track compatibility, containment contracts, layer asset references, effect targets and valid keyframe data.

## 2. Operation boundary

All durable edits are represented as a small set of graph operations:

- `node.add`
- `node.update`
- `node.remove`
- `edge.add`
- `edge.remove`

`preflightOperations` validates schemas, applies to immutable intermediate graph values and checks final project invariants. If anything fails, the original graph remains untouched and the thrown diagnostic identifies the failure phase/index where possible.

High-level editing functions (trim, split, transform, keyframe, effect creation, etc.) return these operations instead of mutating state directly.

## 3. Timeline semantics

`timeline.js` owns temporal edit behavior independent from the Studio UI:

- snap-point discovery;
- snapping;
- move/track move;
- trim;
- split;
- ripple delete;
- ripple insert;
- slip;
- playback-rate changes;
- overlap discovery;
- timeline duration.

Track lock state is enforced by editing functions, not merely drawn in the interface.

## 4. Spatial composition

`transforms.js` defines a nondestructive transform primitive shared by layers and clips: position, scale, rotation, opacity, anchors and crop values.

A Canvas layer is just another graph node containing a reference to a shared asset. Its transform/effects/keyframes are metadata, leaving source media untouched.

## 5. Motion and effects

`keyframes.js` stores numeric property keyframes on graph nodes and evaluates them at arbitrary time. The implementation currently supports linear, hold, ease-in, ease-out and ease-in-out interpolation.

`effects.js` represents ordered nondestructive effect nodes targeting layers/clips. Studio currently previews several visual effects with browser CSS filters, while the core evaluation plan remains renderer-neutral.

## 6. Evaluation, not flattening

`evaluation.js` converts graph + time into a renderer-neutral plan containing:

- composition dimensions/background/frame;
- active Canvas layers;
- active timeline clips;
- source time for each clip;
- evaluated transforms/keyframes;
- active effect stacks;
- active audio items.

This is the seam for a future high-performance renderer. The editor should not need to change its project model when the implementation moves from browser DOM/CSS to WebGPU/WASM/native kernels.

## 7. Media adapters

Browser-specific code is deliberately outside `packages/core`.

`apps/studio/media-engine.js` currently handles:

- metadata probing;
- sampled source fingerprints;
- audio waveform decoding/downsampling;
- browser video-frame capture fallback;
- capability detection.

`gpu-compositor.js` boots a real WebGPU canvas when available and falls back to Canvas2D. It is intentionally a foundation rather than a claim of a complete GPU media renderer.

## 8. Storage

The graph is stored separately from large source blobs in IndexedDB. Graph assets use stable `media://asset/<id>` locators. Browser object URLs are ephemeral runtime bindings and never form the project identity.

This separation enables relinking and later supports proxies, caches, cloud/object storage and packaged projects without changing core graph identity.

## 9. Planner/model providers

`providers.js` defines a provider registry and validated async planning contract. A provider receives graph + intent + context and must return `{ summary, operations }`.

Model output is therefore data to validate, not privileged code to execute.
