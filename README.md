# Media

Media is an experimental unified creative workstation for image, video, audio, animation and emerging media.

The architectural thesis remains: **the creative project is the product, not a collection of application-specific files**. Canvas, Cut, Motion, Deliver and Agent are views over one Universal Creative Graph, reversible history and a shared media-kernel contract.

## Current milestone — 0.14

0.14 moves adaptive fidelity from an additive 0.13 experiment into the **normal Cut composition-preview loop** while preserving the existing graph/evaluation/render contracts.

### Real Cut fidelity loop

Cut now evaluates a composition once, resolves its true FPS from the evaluated composition identity, chooses a fidelity plan and renders that same evaluated plan through the established composition engine.

The feedback loop is executable rather than descriptive:

- scrubbing immediately drops to one temporal sample, one vector sample and a reduced preview resolution;
- normal playback adapts preview resolution plus temporal/vector quality hints from EWMA render cost and recent stale-frame pressure;
- render outcomes feed the next fidelity decision;
- export remains full resolution and preserves requested reference quality;
- switching/invalidation resets performance pressure so one expensive composition does not permanently degrade another.

### Cancellation-safe seeking

Interactive Cut seeks now cancel the previous scrub request with `AbortController`. Cancelled and failed renders are tracked separately from presented/stale frames and do not poison the fidelity performance model.

`CompositionPlaybackEngine.presentEvaluated()` is the new integration seam. It avoids duplicate graph evaluation, applies the fidelity resolution scale to preview width/height/pixel budgets, carries fidelity metadata into both Canvas2D and WebGPU render calls and keeps the existing latest-generation stale-frame guard.

### 0.13 media/runtime foundations remain

The 0.13 MPEG-TS, period-aware DASH, secure codec-plugin and non-contiguous WebCodecs payload paths remain intact. The 0.14 change is deliberately concentrated on product playback integration rather than replacing those parsers/runtimes again.

## Deliberate 0.14 boundaries

Preview resolution scaling is active in normal Cut playback. Temporal motion-blur sample counts and vector supersampling are propagated as fidelity hints for the existing reference kernels; they are not yet the default multi-sample real-time compositor. The TS reference path still targets 188-byte MPEG-TS rather than 192-byte M2TS, and broader LATM/MP3/AC-3/E-AC-3 framing, HEVC parameter metadata, DRM/key acquisition and calibrated OS HDR output remain future work.

## Run locally

```sh
npm run dev
npm test
npm run syntax:check
npm run build
npm run check
npm run conformance
npm run stress
```

## Engineering principle

The UI is not the source of truth. Gestures, agents, Workers, adaptive manifests, range/segment sources, codec/decryptor/plugin backends, GPU passes, derivative jobs and resumable render checkpoints converge on the same graph/evaluation/kernel contracts.

See `docs/ARCHITECTURE.md`, `docs/ENGINE.md`, `docs/KERNEL.md`, `docs/SOURCE_IO.md`, `docs/LIVE_MEDIA.md`, `docs/ADAPTIVE_STREAMING.md`, `docs/MPEG_TS.md`, `docs/PLAYBACK.md`, `docs/EXPORT.md`, `docs/GPU.md`, `docs/MOTION_RENDERING.md`, `docs/AUDIO.md`, `docs/CODECS.md`, `docs/CONFORMANCE.md`, `docs/STRESS.md`, `docs/PROJECT_FORMAT.md`, `docs/DECISIONS.md` and `docs/ROADMAP.md`.
