# Source IO

Media consumers depend on an async range contract:

```text
source.size
source.read(offset, length, { signal }) -> Uint8Array
```

Blob, HTTP Range, memory, composite and paged-cache sources implement this contract.

## MP4/MOV

Classic MP4 reads top-level headers plus `ftyp/moov`; sample payload is requested later from absolute `stco/co64` ranges. 0.10 adds sparse fragmented MP4: `moov` is read once and each `moof` is parsed independently to resolve `tfhd/tfdt/trun` samples. Common `default-base-is-moof` addressing is sparse; unsupported fragment addressing retains an explicit bounded fallback.

## WebM

Static WebM reads metadata plus block/lacing prefixes. The live indexer extends this to append-only unknown-size Clusters. Partial tails are not corruption; a later refresh continues from the previous cursor.

## Encoded windows

Chunk descriptors are selected before source bytes. Adjacent source ranges are coalesced, compacted into one transferable buffer and descriptors are rewritten to buffer-local offsets.

## Composite sources

`CompositeRangeSource` exposes multiple byte artifacts as one logical source. Resumable MP4 finalization uses this to parse `init + media segments` without first concatenating them.
