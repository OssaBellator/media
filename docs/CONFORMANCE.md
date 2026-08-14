# Conformance and performance

The conformance harness separates deterministic repository fixtures from optional real media.

Run:

```sh
npm run conformance
MEDIA_CORPUS_DIR=/path/to/corpus npm run conformance
```

`conformance/corpus.json` describes a bundled deterministic fragmented-MP4 fixture plus optional camera, screen-recording, CMAF/live-stream and audio-only cases. Missing optional files are **skipped**, never counted as passes.

## Performance reports

0.11 can emit a machine-readable report and compare percentile metrics against a baseline:

```sh
MEDIA_CONFORMANCE_REPORT=artifacts/report.json npm run conformance
MEDIA_CONFORMANCE_BASELINE=baseline.json MEDIA_MAX_REGRESSION=.10 npm run conformance
```

Reports include p50/p95/p99/min/max/mean summaries, fixture-kind groups and basic runtime environment metadata. Baseline comparison can fail the process when a configured regression threshold is exceeded.

For release/lab runs where the external corpus is mandatory:

```sh
MEDIA_REQUIRE_CORPUS=1 MEDIA_CORPUS_DIR=/mnt/media-corpus npm run conformance
```

Any skipped fixture then makes the run fail.

Per-fixture checks can include container/codec/dimension expectations, sample byte ranges, decode-timeline validity, sparse-index read amplification, index latency and browser-probe metrics such as cache/stale/drop ratios. Large camera/device media remains intentionally out of tree.
