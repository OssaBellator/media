# Stress validation

Run:

```sh
npm run stress
```

The default workload projects a 12-hour 60 fps A/V MP4, separately validates a three-day 30 fps A/V MP4 layout budget, parses 10,000-segment HLS and DASH manifests, and rasterizes a feathered vector matte. It does not allocate millions of encoded sample payloads.

Controls:

```sh
MEDIA_STRESS_HOURS=24 npm run stress
MEDIA_STRESS_MULTI_DAY_HOURS=96 npm run stress
MEDIA_STRESS_HLS_SEGMENTS=50000 npm run stress
MEDIA_STRESS_MATTE_SIZE=512 npm run stress
MEDIA_STRESS_REPORT=artifacts/stress.json npm run stress
```

`projectClassicMp4Scale()` estimates sample/chunk counts and table bytes. `validateClassicMp4Scale()` enforces configurable metadata/sample/chunk ceilings. The fixed multi-day projection uses the same one-second/two-track chunk model as the streaming MP4 finalizer's default interleave policy and a 128 MiB metadata ceiling.

Stress projections complement the real-media conformance corpus; they are not substitutes for device/browser decode benchmarks.
