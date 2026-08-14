# Stress validation

Run:

```sh
npm run stress
```

The default workload projects a 12-hour 60 fps A/V MP4, parses 10,000-segment HLS and DASH manifests, and rasterizes a feathered vector matte. It does not allocate millions of encoded sample payloads.

Controls:

```sh
MEDIA_STRESS_HOURS=24 npm run stress
MEDIA_STRESS_HLS_SEGMENTS=50000 npm run stress
MEDIA_STRESS_MATTE_SIZE=512 npm run stress
MEDIA_STRESS_REPORT=artifacts/stress.json npm run stress
```

`projectClassicMp4Scale()` estimates sample/chunk counts and table bytes. `validateClassicMp4Scale()` enforces configurable metadata/sample/chunk ceilings.

Stress projections complement the real-media conformance corpus; they are not substitutes for device/browser decode benchmarks.
