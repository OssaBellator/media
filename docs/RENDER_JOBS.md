# Resumable render jobs

Render jobs are deterministic state machines keyed by the Deliver manifest signature.

Each chunk contains frame/time bounds, attempts, worker ownership and an artifact reference. State transitions are:

```text
pending -> running -> complete
              |\
              | -> pending   (retry/interruption)
              -> failed      (attempts exhausted)
```

A user cancellation uses `releaseRenderChunk()` and, by default, restores the claimed attempt. Decoder/encoder/render failures use normal retry accounting.

Studio stores:

- the render-job state;
- one fMP4 initialization artifact;
- one media-segment artifact per completed chunk.

On startup/resume, interrupted `running` chunks recover to pending, while completed chunks remain immutable and are skipped.

The final assembly index is intentionally independent of storage implementation so a future native/cloud renderer can use the same job state and byte/time segment contract.
