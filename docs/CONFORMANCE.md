# Conformance and performance

The conformance harness separates deterministic repository fixtures from optional real media.

Run:

```sh
npm run conformance
MEDIA_CORPUS_DIR=/path/to/corpus npm run conformance
```

`conformance/corpus.json` currently describes a bundled synthetic fragmented-MP4 fixture plus optional categories for iPhone HEVC/HDR MOV, Android H.264/AAC MP4, Sony XAVC-S, OBS VP9/Opus WebM, CMAF fMP4, unknown-size live WebM and AAC-only M4A.

Optional missing files are **skipped**, never counted as passes.

Per-fixture checks can include:

- container/track/codec/dimension expectations;
- sample byte-range validity;
- decode-timeline monotonicity;
- sparse-index source-read amplification;
- index latency;
- decode milliseconds per decoded media second;
- playback cache/stale/drop ratios when a browser probe supplies them.

Large camera/device files are intentionally not committed to the repository.
