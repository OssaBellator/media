# Live media

0.11 separates byte transport, incremental indexing and codec scheduling.

## Byte transport

`AppendRangeSource` is the in-memory transport boundary. `pumpReadableStreamToRangeSource()` consumes an arbitrary `ReadableStream` while respecting high-water backpressure. The Studio `LiveHttpTransport` adds reconnect behavior:

```text
HTTP body
  -> append range source
  -> wait/index/read
  -> acknowledge
  -> prune old bytes
```

A reconnect requests `Range: bytes=<absolute-end>-`. If a server ignores that resume range and returns a fresh full response, the transport fails rather than duplicating already received bytes.

## Live WebM

`LiveWebmClusterIndexer` is stateful across source growth. Unknown-size Clusters stay open, partial element/block tails wait for more bytes and completed frames are emitted once. `LiveWebmSession` combines indexing with acknowledgement/pruning.

## CMAF/fMP4

`CmafSegmentSession` keeps initialization state separate from complete media segments. Each segment is sparsely indexed independently; sample reads use segment-local ranges; acknowledged old segments can be evicted without constructing one unbounded append buffer.

## Not included

These primitives are not an HLS/DASH manifest client, ABR policy, DRM license client or network retry policy for every streaming protocol. They are the transport/index boundaries those systems can drive.
