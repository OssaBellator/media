# Conformance and performance

The conformance harness separates deterministic repository fixtures from optional real media.

```sh
npm run conformance
MEDIA_CORPUS_DIR=/path/to/corpus npm run conformance
```

`conformance/corpus.json` describes a bundled deterministic fragmented-MP4 fixture plus optional camera, screen-recording, CMAF/live-stream and audio-only cases. Missing optional files are **skipped**, never counted as passes.

## Performance reports

```sh
MEDIA_CONFORMANCE_REPORT=artifacts/report.json npm run conformance
MEDIA_CONFORMANCE_BASELINE=baseline.json MEDIA_MAX_REGRESSION=.10 npm run conformance
```

Reports include p50/p95/p99/min/max/mean summaries, fixture-kind groups and runtime environment metadata.

For release/lab runs where the external corpus is mandatory:

```sh
MEDIA_REQUIRE_CORPUS=1 MEDIA_CORPUS_DIR=/mnt/media-corpus npm run conformance
```

## Longitudinal history

0.12 can append a report to an environment-keyed history and optionally enforce long-run budgets:

```sh
MEDIA_CONFORMANCE_REPORT=artifacts/report.json npm run conformance:history
MEDIA_CONFORMANCE_HISTORY=artifacts/history.json \
MEDIA_CONFORMANCE_LONGRUN_BUDGETS=budgets.json \
npm run conformance:history
```

History is bounded per environment. Budget rules can constrain absolute min/max values or maximum regression ratio versus a rolling prior window.

## Synthetic stress

`npm run stress` complements the fixture corpus with long-output/adaptive/vector workload projections. See `docs/STRESS.md`.

Per-fixture checks can include container/codec/dimension expectations, sample byte ranges, decode-timeline validity, sparse-index read amplification, index latency and browser-probe metrics. Large camera/device media remains intentionally out of tree.
