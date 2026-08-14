# Changelog

## 0.7.0

- Added an in-memory classic fast-start MP4/MOV writer for AVC + AAC.
- Added fragmented-MP4 init/media writers using `mvex/trex`, `tfhd`, `tfdt` and `trun`.
- Added `edts/elst` v0/v1 parsing and simple 1× edit-list application during MP4 demux.
- Added leading-empty-edit emission when classic mux tracks begin after movie time zero.
- Added version-1 `mdhd` output for long-form tracks that exceed 32-bit microsecond duration.
- Added direct WebCodecs encoder-result → mux-plan bridging with decoder-description preservation.
- Added executable thumbnail generation through keyframe-safe WebCodecs decode + canvas encoding.
- Added executable WebM proxy transcoding with resize, VP9/AV1 video, optional Opus audio and explicit batch-memory caps.
- Added real kernel `thumbnail`, `proxy`, MP4/MOV `mux` and fMP4 mux dispatch paths.
- Fixed seek-window overlap so a chunk ending exactly at a keyframe boundary is not included before that keyframe.
- Added 25 focused local 0.7 regression tests across muxing, edit lists, derivatives and export bridging.

## 0.6.0

- Added classic MP4/MOV sample-table demux for `stsd`, `stts`, `ctts`, `stsc`, `stsz`/`stz2`, `stco`/`co64` and `stss`.
- Added common fragmented-MP4 indexing for `trex`, `tfhd`, `tfdt` and `trun` samples.
- Added AVC decoder-description parsing and AAC AudioSpecificConfig extraction.
- Added WebM Tracks/Info/Cluster/Cues, SimpleBlock/BlockGroup and fixed/Xiph/EBML lacing demux.
- Added actual PCM/float WAV encoding and round-trip coverage.
- Added browser WebCodecs video/audio decode and encode adapters.
- Added priority Worker-pool scheduling, keyed task deduplication, cancellation and playhead prefetch planning.
- Fixed the kernel transfer boundary so Worker payload ArrayBuffers can be posted zero-copy without cloning away the transferred object.
- Added an in-memory WebM writer for VP8/VP9/AV1 + Opus/Vorbis with keyframe Cues.

## 0.5.0

- Added the versioned media-kernel protocol/runtime, WAV decode, structural MP4/WebM parsing, encoded chunk/seek models, offline PCM primitives, derivative planning, resumable render jobs and the production pipeline DAG.

## 0.4.0

- Added decoded-frame cache/scheduler, audio clip semantics, Deliver output nodes/manifests, project-file v2, derived storage and native text/vector layers.

## 0.3.0

- Added semantic invariants, Canvas transforms, Motion keyframes/effects, advanced timeline semantics, frame transport, source fingerprints/relinking and planner-provider contracts.

## 0.2.0

- Added durable IndexedDB projects/media, versioned project files and core timeline editing.

## 0.1.0

- Initial Universal Creative Graph and dependency-light Studio alpha.
