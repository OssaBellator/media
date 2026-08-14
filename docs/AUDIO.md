# Audio engine

Interactive playback still uses Web Audio scheduling, gain/pan/fades and the shared timeline clock.

## Range-driven offline decode

For compressed AAC/Opus sources, offline Deliver now prefers:

```text
mix-plan source spans
  -> sparse container index
  -> overlapping encoded chunks only
  -> compact range reads
  -> codec decoder
  -> AudioData.copyTo(f32-planar)
  -> close AudioData
  -> sparse PCM blocks
  -> automated offline mix
```

Sparse PCM blocks preserve absolute source sample offsets, so disjoint clip references do not require decoding or allocating the gaps between them. Whole-Blob `AudioContext.decodeAudioData()` remains a compatibility fallback for unsupported source/container/backend combinations.

Loudness analysis/normalization remains an engineering BS.1770-style reference, not a certified broadcast meter.
