# Source IO

## Contract

Media source consumers depend on an async range contract, not on `Blob.arrayBuffer()`:

```text
source.size
source.read(offset, length, { signal }) -> Uint8Array
```

Core validates integer ranges, exact returned lengths and source bounds. Browser adapters provide Blob slicing and HTTP `Range` requests. `PagedRangeSource` adds bounded page caching and in-flight page deduplication.

## Encoded windows

Demux chunk descriptors keep absolute source offsets. A seek/proxy operation selects chunk descriptors first, then `compactEncodedWindowFromSource()`:

1. derives exact byte ranges;
2. merges nearby ranges within configured gap/size limits;
3. reads only those ranges;
4. concatenates payloads into one transferable buffer;
5. rewrites chunk offsets against that compact buffer.

The Worker therefore receives no file-global offsets and no unused source bytes.

## MP4/MOV

Classic MP4/MOV range indexing scans top-level box headers and reads `ftyp` + `moov`. `stco`/`co64` sample offsets remain absolute against the original source. `mdat` is skipped during indexing.

Fragmented MP4 still has an explicit bounded full-source fallback because the current `moof` indexer expects a contiguous view. Sources over the configured fallback cap fail rather than silently materializing an unbounded buffer.

## WebM

The sparse WebM index reads the EBML header, Info/Tracks and Cluster child headers. SimpleBlock/BlockGroup parsing reads only enough block prefix bytes to decode track/timecode/flags/lacing sizes; frame payloads remain unread until decode-window compaction.

Unknown-size live Cluster streams remain future work.

## Metrics

Paged sources expose cache hit/miss data plus upstream read statistics. Cut aggregates source bytes read and encoded bytes consumed into a read-amplification ratio used by conformance fixtures.
