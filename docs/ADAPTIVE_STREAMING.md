# Adaptive streaming

0.12 places HLS/DASH acquisition **above** the range/container/codec kernel. A manifest decides which bytes should arrive; it does not create a second decode engine.

```text
HLS / DASH manifest
      ↓
normalized variants + segments
      ↓
ABR / live-edge / retry policy
      ↓
init + media byte-range fetches
      ↓
CMAF segment session / sparse container index
      ↓
protected-sample boundary
      ↓
codec backend router
```

## HLS

The normalized model includes master variants and renditions, media sequence, target duration, byte ranges, `EXT-X-MAP`, `EXT-X-KEY`, program date-time, discontinuities, gaps and end-list state.

Low-latency/delta support includes `EXT-X-PART`, `EXT-X-PART-INF`, `EXT-X-SERVER-CONTROL`, `EXT-X-PRELOAD-HINT`, `EXT-X-SKIP` and rendition reports. Segment delivery is ledgered so a refreshed current part is not emitted twice.

`AES-128` whole-segment encryption requires an injected `decryptSegment`. SAMPLE-AES forms are left protected for the downstream sample/container boundary. MPEG-TS is deliberately unsupported until Media has a TS demuxer.

## DASH

Common ISO-BMFF delivery forms are normalized:

- `SegmentTemplate` with fixed duration;
- `SegmentTemplate` + `SegmentTimeline`;
- dynamic duration templates projected from `availabilityStartTime` and `timeShiftBufferDepth`;
- `SegmentList` + media/init byte ranges;
- `SegmentBase@indexRange` + `Initialization`;
- `sidx`, including bounded hierarchical sub-index expansion.

`ContentProtection` scheme/KID/PSSH values remain attached to representations. Actual CENC sample metadata/decryption is handled by the ISO-BMFF kernel.

## ABR

`AdaptiveSessionState` uses a conservative dual-EWMA throughput estimate. Selection considers declared/average bitrate, a safety factor, current rendition, upgrade margin and resolution/pixel caps.

This is intentionally a small deterministic reference ABR policy, not a claim to reproduce mature player heuristics.
