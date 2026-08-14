# Architecture

## North-star

Media treats a project as one durable graph projected into specialized views rather than a bundle of application-specific files.

```text
 Human gesture / Agent intent
             │
             ▼
     Planner / UI command
             │
             ▼
   operation schema + preflight
             │
             ▼
   Universal Creative Graph ◄──── undo/redo
             │
      semantic invariants
             │
             ▼
     composition evaluation
             │
       render/audio plans
        ┌────┴────────┐
        ▼             ▼
 browser runtime   future native/cloud runtime
 frame/audio/GPU   codecs/GPU/render farm
```

## 1. Universal Creative Graph

Current node kinds:

- `project`
- `asset`
- `composition`
- `track`
- `clip`
- `layer`
- `effect`
- `output`

Edges make containment, references and output/effect targets explicit. A source asset can be referenced by Canvas and Cut without duplication. Text and shape layers are native graph objects and therefore need no asset.

Structural validation lives in `graph.js`; domain rules live in `invariants.js`.

## 2. Durable mutation boundary

Durable state changes use only:

- `node.add`
- `node.update`
- `node.remove`
- `edge.add`
- `edge.remove`

High-level functions return operation batches. `preflightOperations` validates schemas, applies immutable intermediate values and checks final semantic invariants. Provider output, UI edits and future collaboration can therefore share the same contract.

## 3. Timeline domain

`timeline.js` owns edit semantics independently of DOM interactions:

- snap points and snapping;
- move and track moves;
- trim/split/slip;
- duplicate;
- roll edit;
- blade-all;
- ripple insert/delete/trim;
- playback-rate changes;
- overlap discovery;
- track creation/state/lock enforcement;
- timeline duration.

## 4. Spatial and native graphics

`transforms.js` defines position, scale, rotation, opacity, anchors and crop for both layers and clips.

`text.js` creates editable typography layers. `shapes.js` creates native rectangle/ellipse layers. Both share transforms, keyframes, effects and evaluation with source-backed media layers.

## 5. Motion/effects

`keyframes.js` evaluates numeric animation at arbitrary time. `effects.js` represents ordered nondestructive effect nodes targeted at layers/clips.

No animation/effect result is flattened into source media by the semantic engine.

## 6. Evaluation

`evaluation.js` maps graph + time to a renderer-neutral plan containing source-backed visuals, text, shapes, active timeline clips, source time, evaluated transforms/effects and audio items.

This is the key abstraction separating editing semantics from rendering implementation.

## 7. Media scheduling/cache

`cache.js` provides two reusable runtime primitives:

- weighted LRU storage with explicit memory budgets;
- priority/deduplicating asynchronous decode scheduling.

The browser frame provider consumes these primitives. Native/worker runtimes should preserve the contract rather than introducing UI-specific caches.

## 8. Audio

`audio.js` owns dB/gain conversion, pan math, fades, sample/time mapping, clip audio edits and mix plans. `apps/studio/audio-engine.js` translates those semantics into AudioContext nodes for preview.

Offline/export mixing remains a runtime concern.

## 9. Deliver

`deliver.js` treats output intent as project data. Output nodes target compositions and generate deterministic manifests containing settings, dependencies, frame ranges, audio summaries and render signatures.

This makes caching/resume/distributed rendering possible without changing editing state.

## 10. Storage/source identity

Graph assets store metadata and logical locators; source bytes live behind storage adapters. Browser storage separates:

- current graph;
- source blobs + fingerprint metadata;
- derived artifacts.

Project-file v2 includes a formal source manifest. Relinking prefers source fingerprints over filenames.

## 11. Browser runtime

Browser-specific modules remain outside core:

- `media-engine.js` — probing, waveform, fingerprint, frame fallback;
- `render-engine.js` — frame provider/cache/scheduler + Canvas2D plan rendering;
- `audio-engine.js` — AudioContext preview scheduling;
- `gpu-compositor.js` — WebGPU/Canvas2D surface bootstrap;
- `storage.js` — IndexedDB adapters.

## 12. Planner/model providers

Providers receive intent + a sanitized project snapshot and return `{summary, operations}`. HTTP providers are supported through the same validation boundary. Local source URIs and heavyweight waveform samples are omitted from the remote snapshot.

Model output is untrusted data, never privileged code or direct graph mutation.
