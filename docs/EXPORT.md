# Export and delivery

Media supports in-memory classic MP4/WebM, progressive fMP4/WebM and resumable fMP4 render checkpoints.

## Resumable render

Each render chunk owns global output timestamps and can persist picture+audio as an independent fMP4 media segment. Cancellation releases an active chunk without consuming a retry; completed segments survive reload/crash.

## Classic MP4 finalization

0.10 can finalize a completed resumable render:

```text
persisted init + media segments
  -> CompositeRangeSource
  -> sparse fMP4 sample index
  -> exact encoded sample reads
  -> classic MP4 sample tables
  -> fast-start moov + mdat
```

The reference final writer currently rebuilds the final file in memory and enforces a payload cap. A seekable/streaming classic writer is a future optimization, not a missing sample/timestamp model.

## Audio

Offline compressed audio now prefers range-driven AAC/Opus decode into sparse PCM. Whole-source Web Audio decode is fallback.
