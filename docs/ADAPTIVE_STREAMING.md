# Adaptive streaming

0.12 placed HLS/DASH acquisition **above** the range/container/codec kernel. A manifest decides which bytes should arrive; it does not create a second decode engine.

```text
HLS / DASH manifest
      ↓
normalized variants + segments
      ↓
ABR / live-edge / retry / availability policy
      ↓
init + media byte-range or chunked fetches
      ↓
CMAF / MPEG-TS / sparse container session
      ↓
protected-sample boundary
      ↓
codec backend router
```

## HLS

The normalized model includes master variants and renditions, media sequence, target duration, byte ranges, `EXT-X-MAP`, `EXT-X-KEY`, program date-time, discontinuities, gaps and end-list state.

Low-latency/delta support includes `EXT-X-PART`, `EXT-X-PART-INF`, `EXT-X-SERVER-CONTROL`, `EXT-X-PRELOAD-HINT`, `EXT-X-SKIP` and rendition reports. Segment delivery is ledgered so a refreshed current part is not emitted twice.

`AES-128` whole-segment encryption requires an injected `decryptSegment`. SAMPLE-AES forms remain protected for the downstream sample/container boundary. Legacy 188-byte MPEG-TS HLS is handled by the 0.13 transport-stream kernel, including PAT/PMT, PES reconstruction, timestamp unwrap, H.264/H.265 access units and AAC/ADTS reframing; see `MPEG_TS.md` for current codec and PSI limits.

## DASH

The DASH stack now has two complementary normalization surfaces. The range-oriented path covers `SegmentList`, `SegmentBase@indexRange`, initialization ranges and bounded hierarchical `sidx` expansion. The v2 live/session path covers `SegmentTemplate` fixed-duration and `SegmentTimeline` media across multiple periods.

The v2 model also preserves and acts on live-control metadata:

- multi-period switching with period-unique representation identity;
- `EventStream` presentation times normalized onto the global timeline;
- `UTCTiming` direct, HTTP HEAD and HTTP body clock synchronization;
- `ServiceDescription` latency/playback-rate targets;
- `minimumUpdatePeriod`-driven live manifest refresh before each pump when due;
- `availabilityTimeOffset` and `availabilityTimeComplete` on media segments;
- synchronized availability gating before live requests;
- incremental response chunk callbacks for `availabilityTimeComplete="false"` segments before whole-segment delivery;
- optional CMAF fragment assembly that emits complete `moof` + `mdat` units through `onFragment` as soon as each unit arrives, before the full HTTP segment completes.

`DashCmafSession` connects that acquisition boundary to the container layer. Initialization segments create independent per-variant `CmafSegmentSession` instances; each emitted low-latency `moof` + `mdat` unit is demuxed and indexed immediately, while the later whole HTTP segment callback is deliberately not demuxed a second time. Complete non-low-latency media segments use the same CMAF session path.

`CmafWebCodecsSession` keeps one WebCodecs decoder alive per variant and media track, reads only the indexed sample ranges from each CMAF record, submits samples with queue backpressure, and resets decoders when a variant receives a replacement initialization segment. Protected samples are rejected until they cross the existing decryption boundary. `DashCmafWebCodecsSession` composes this with `DashCmafSession`, so samples from a low-latency fragment are submitted to WebCodecs from the fragment callback before the enclosing HTTP segment completes.

`LiveDecodedMediaScheduler` owns bounded decoded video/audio queues, closes superseded/late/capacity-evicted outputs, schedules audio only within a configurable lookahead and discards stale decoder output after representation switches. `DashCmafLivePlaybackSession` composes that scheduler with the decode session and exposes a playhead-seconds `present()` boundary.

`BrowserLivePlaybackOutput` binds that boundary to real browser output: decoded `VideoFrame` objects reuse the normal Cut `data-kernel-playback` canvas when present, while decoded `AudioData` is copied as `f32-planar` PCM into Web Audio buffers, scheduled against the AudioContext clock, offset when slightly late and re-anchored when playhead drift crosses the configured tolerance. `DashCmafBrowserPlaybackSession` composes the complete transport→demux→decode→queue→browser-output path. The next Studio integration is routing adaptive DASH sources through this session from the normal Cut source/runtime boundary rather than invoking it as a standalone playback session.

`ContentProtection` scheme/KID/PSSH values remain attached to representations. Actual CENC sample metadata/decryption is handled by the ISO-BMFF kernel.

## ABR

`AdaptiveSessionState` uses a conservative dual-EWMA throughput estimate. Selection considers declared/average bitrate, a safety factor, current rendition, upgrade margin and resolution/pixel caps. `DashStreamSessionV2` carries representation preference across periods and updates its throughput estimate from completed media transfers.

This remains a small deterministic reference ABR/acquisition policy, not a claim to reproduce mature player heuristics.
