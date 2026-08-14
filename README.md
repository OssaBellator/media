# Media

Media is an experimental unified creative workstation for image, video, audio, animation and emerging media.

The architectural thesis is simple: **the creative project is the product, not a collection of application-specific files**. Canvas, Cut, Motion, Deliver and Agent are views over the same Universal Creative Graph, shared source media and reversible edit history.

## Current milestone — 0.6

0.6 moves the production kernel from structural container inspection to usable byte-range demux, browser codec adapters and real output writers.

### Creative/editor layer

The 0.4/0.5 editor foundation remains: Universal Creative Graph, Canvas, multi-track Cut, Motion keyframes/effects, audio editing, Deliver render manifests/stills, Agent provider boundaries, IndexedDB media/derived storage and resumable render jobs.

### Native demux paths

- classic non-fragmented MP4/MOV sample tables: `stsd`, `stts`, `ctts`, `stsc`, `stsz`/`stz2`, `stco`/`co64`, `stss`;
- common fragmented MP4: `trex`, `tfhd`, `tfdt`, `trun` with byte-range/sample timing indexes;
- H.264 `avcC` decoder descriptions and RFC6381-style AVC codec strings;
- AAC `esds` AudioSpecificConfig extraction for WebCodecs decoder configuration;
- WebM Segment/Info/Tracks/Cluster/Cues parsing;
- SimpleBlock and BlockGroup extraction;
- no/fixed/Xiph/EBML lacing support;
- normalized encoded chunk descriptors with source byte offsets, DTS/PTS and keyframe state.

### Decode / encode runtime

- WebCodecs video and audio decoder adapters consuming demuxed chunk descriptors;
- WebCodecs video/audio encoder adapters producing mux-ready copied encoded chunks;
- transferable-safe Worker kernel tasks instead of cloning away the posted buffers;
- bounded priority Worker pool with keyed deduplication, cancellation and idle tracking;
- playhead-oriented keyframe-safe prefetch controller;
- runtime capability/support checks so unsupported codecs fail explicitly rather than silently falling back.

### Output paths

- actual PCM/IEEE-float WAV writer, including 8/16/24/32-bit PCM and float32 output;
- in-memory WebM writer for VP8/VP9/AV1 video plus Opus/Vorbis audio;
- WebM clusters, SimpleBlocks and keyframe Cues;
- generated WebM files round-trip through Media's own WebM demuxer in local tests;
- existing semantic mux plans remain the boundary for future MP4 and streaming writers.

### Deliberate boundary

0.6 still does **not** claim a complete professional container stack. MP4 edit lists are not applied yet, unusual fragmented-MP4 base-offset inheritance needs broader conformance fixtures, HEVC/AV1 codec configuration coverage can be deeper, and an actual MP4 binary mux writer is still outstanding. The current WebM writer is in-memory rather than streaming.

Those are now implementation gaps above a working demux/decode/encode contract rather than missing architecture.

## Run locally

Requires Node.js 22+.

```bash
npm run dev
```

Open `http://127.0.0.1:4173`.

There are currently no runtime package dependencies and no install step is required for the prototype.

## Validate locally

GitHub Actions is intentionally not used. The repository-owned gate is:

```bash
npm run check
```

Useful commands:

```bash
npm run syntax:check
npm test
npm run test:watch
npm run build
```

## Keyboard controls

In Cut or Motion:

- `Space` — play/pause
- `Left` / `Right` — previous/next frame
- `M` — add a marker at the playhead
- `S` — split selected clip at playhead
- `B` — blade all unlocked clips intersecting the playhead
- `Cmd/Ctrl+Z` — undo
- `Cmd/Ctrl+Shift+Z` — redo

## Repository layout

```text
apps/studio/             Browser Studio and browser/runtime/kernel adapters
apps/studio/test/        Runtime-module tests runnable in Node
packages/core/src/       Creative semantics plus media-kernel contracts/parsers/writers
packages/core/test/      Core unit/integration tests
scripts/                 Dependency-free dev/build/check tooling
docs/                    Architecture, engine/kernel contracts, project format, roadmap
```

## Engineering principle

The UI is not the source of truth. Mouse gestures, keyboard shortcuts, agent plans, future plugins, collaboration and native frontends should converge on the same operation/evaluation/kernel contracts.

See `docs/ARCHITECTURE.md`, `docs/ENGINE.md`, `docs/KERNEL.md`, `docs/PROJECT_FORMAT.md`, `docs/DECISIONS.md` and `docs/ROADMAP.md`.
