# Roadmap

This roadmap is ordered around product risk rather than feature count.

## Phase 0 — Prove the shared project model

**Status: started**

- [x] Universal Creative Graph v1
- [x] graph validation and serialization
- [x] reversible project history
- [x] Canvas / Cut / Agent shell
- [x] local image/video/audio import
- [x] declarative agent operation protocol
- [x] local test/build gate with no GitHub Actions
- [ ] project-file import
- [ ] persisted local asset handles/content store
- [ ] clip trim/move/split operations
- [ ] canvas transform operations
- [ ] real media metadata extraction
- [ ] operation schema validation with migration support

**Exit criterion:** the same asset can be edited through Canvas and Cut without duplicate document state, with every edit surviving export/reload and undo/redo.

## Phase 1 — A credible image + video editor

- non-destructive visual layers and transforms;
- masks and temporal masks;
- timeline trim, slip, ripple, transitions and markers;
- waveform generation and dialogue tracks;
- colour pipeline and effects graph;
- thumbnail/proxy generation;
- keyboard-driven professional editing;
- IndexedDB or desktop-backed content-addressed media store;
- WebGPU render/evaluation experiments;
- project migration and corruption recovery tests.

**Exit criterion:** a creator can cut and finish a short social film without leaving Media.

## Phase 2 — Model-backed editable delegation

- provider-neutral model router;
- project-level semantic index;
- transcription and shot/object understanding;
- agent planner producing validated operation batches;
- preview/diff/approve flow for destructive or expensive plans;
- provenance attached to generated/edited creative objects;
- model cost estimates and explicit compute accounting;
- background replacement, generative fill and temporal edit adapters.

**Exit criterion:** an AI-created change remains first-class, inspectable project structure rather than a flattened generated file.

## Phase 3 — Motion + Mix

- property animation and keyframes;
- expressions and procedural relationships;
- node/graph view over effects and automation;
- multitrack audio mixing;
- automation lanes, effects and buses;
- beat/section analysis;
- music-to-picture restructuring primitives.

## Phase 4 — Scene + platform

- 3D scene objects, cameras, lights and materials;
- spatial video/audio primitives;
- plugin SDK and sandbox;
- model-provider SDK;
- automation API;
- render workers;
- collaborative graph/history protocol.

## Not yet

Do not spend early cycles cloning every panel in Photoshop, Premiere, After Effects, Ableton or Blender. The advantage must come from the shared object model and cross-media workflows. Specialist depth should be added where users hit real limits, not as a checklist against incumbents.
