# Export and delivery

Deliver continues to consume evaluated composition state rather than introducing a second edit model.

## Direct render

Small outputs can still render frame-by-frame into WebCodecs and use classic in-memory MP4/WebM muxing. Progressive WebM/fMP4 byte sinks remain available for direct file streaming.

## Resumable fMP4

0.9 wires the existing core render-job model into Studio delivery:

```text
render manifest
  -> fixed frame chunks
  -> claim chunk
  -> render video + audio concurrently
  -> encode with global output-relative timestamps
  -> create fMP4 init/media segment
  -> persist segment artifact
  -> complete checkpoint
  -> resume remaining chunks after interruption
```

Explicit cancellation releases the active chunk without consuming an attempt. Codec configuration is fingerprinted across segments; a changed decoder configuration fails rather than assembling incompatible fragments.

Assembly writes the initialization artifact followed by completed media segments in index order. It also returns a deterministic fragment index containing output time range, byte offset and byte length for each segment.

## Streaming WebM

The streaming writer uses an unknown-size Segment and forward Cluster writes. 0.9 appends Cues at close using the keyframe cluster byte positions collected while writing. This improves random access without requiring a seekable sink. A final SeekHead rewrite is still future work.

## Remaining boundary

Resumable delivery intentionally produces fragmented MP4. Rebuilding a fast-start classic MP4 would require a final sample-table rewrite/seekable sink pass. That is separate from checkpoint safety and is not claimed in 0.9.
