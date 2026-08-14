# Roadmap

## 0.1–0.4 — creative engine ✅

Universal Creative Graph, operation/history boundary, Canvas/Cut/Motion/Agent/Deliver views, persistence, transforms/keyframes/effects, audio clip semantics, render manifests, text/shapes and project/source identity.

## 0.5–0.7 — production media kernel ✅

Kernel protocol/runtime, WAV, MP4/WebM demux, keyframe seek indexes, Worker/WebCodecs adapters, offline PCM, derivative/render jobs, WebM writer, classic/fMP4 writer, edit lists, thumbnails and bounded proxy transcode.

## 0.8 — integrated playback/render processing ✅ reference implementation

- Worker-pool/WebCodecs Cut playback
- streamed decoded-frame progress + bounded frame cache
- compact encoded seek windows
- segmented/resumable IndexedDB proxy jobs
- full timeline WebCodecs Deliver render
- progressive fMP4/WebM byte sinks
- HEVC/AV1 MP4 sample entries
- color/HDR/rotation/pixel-aspect metadata preservation
- WebGPU frame texture cache
- WGSL common-effect pass
- offline audio automation + loudness/peak normalization

## 0.9 — make the reference paths production-grade

- range-addressable source IO and incremental demux
- composition-aware multi-layer GPU playback
- streaming decoder → proxy encoder inside segments
- simultaneous progressive A/V render scheduling
- resumable final-render segment persistence
- proxy stitching/index manifests used automatically by playback
- color management/tone mapping and scopes
- richer audio buses/effects and streaming loudness meter
- real camera/browser/container conformance corpus
- performance budgets/telemetry for decode, GPU, memory and export

## 1.x — professional editing and collaboration

- nested/compound compositions and transitions
- masks/tracked masks
- captions/transcripts
- keyframe graph editor
- multicam
- operation log and multiplayer branches/merge
- review/comments
- production model-provider adapters and agent evaluation

## Long-term

- native/WASM codecs and heavy effects
- 3D/scene workspace
- MIDI/music composition
- distributed render execution
- plugin SDK and open interchange bridges
- responsive multi-output campaign automation
