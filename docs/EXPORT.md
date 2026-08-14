# Export and delivery

Media supports in-memory classic MP4/WebM, progressive fMP4/WebM and resumable fMP4 render checkpoints.

## Resumable render

Each render chunk owns global output timestamps and can persist picture+audio as an independent fMP4 media segment. Cancellation releases an active chunk without consuming a retry; completed segments survive reload/crash.

## Streaming classic MP4 finalization

0.11 finalizes checkpoints without rebuilding the final file in memory:

```text
persisted init + segment metadata
  -> LazyCompositeRangeSource
  -> sparse fragmented-MP4 index
  -> precomputed fast-start moov
  -> co64/stsc/stsz/stts/ctts tables
  -> sample-by-sample source reads
  -> output sink
```

The metadata header is calculated before `mdat`, so no output seek is required. Encoded sample payload memory is bounded to the sample currently being written. Consecutive same-track output runs share chunk-table entries.

The writer preserves:

- AVC/HEVC/AV1 decoder descriptions and AAC AudioSpecificConfig;
- signed composition offsets for reordered frames;
- non-zero track starts using a leading `edts/elst` edit;
- rotation matrices;
- pixel aspect ratio;
- nclx primaries/transfer/matrix/full-range state;
- CLLI/MDCV HDR metadata.

Protected fMP4 remains rejected by the finalizer unless a downstream authorized clear-media path is deliberately implemented; Media does not silently strip encryption signaling while copying encrypted bytes into a clear sample entry.

## Audio

Offline compressed audio prefers range-selected AAC/Opus decode into sparse PCM. Encrypted audio fails before WebCodecs unless an authorized exact-sample decryptor is injected. Whole-source Web Audio decode remains compatibility fallback for unprotected formats outside the range decoder.
