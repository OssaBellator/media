# Source IO

Media consumers depend on an async absolute-range contract:

```text
source.size
source.read(offset, length, { signal }) -> Uint8Array
```

Memory, Blob, HTTP Range, paged-cache, eager composite, lazy composite and append-only sources implement compatible semantics.

## Static sources

Classic MP4/MOV reads top-level headers plus `ftyp/moov`; sample payload is requested later from absolute `stco/co64` ranges. Fragmented MP4 reads the init metadata and individual `moof` structures while leaving referenced `mdat` sample bytes untouched until decode/finalization. Static WebM reads EBML metadata plus block/lacing prefixes while skipping compressed frame bodies.

## Append-only sources

`AppendRangeSource` gives growing media an absolute address space with:

- `waitForSize()` for partial arrivals;
- high/low-water backpressure;
- cross-chunk reads;
- cancellation;
- `pruneBefore()` for already-consumed data;
- retained/read byte statistics.

Pruning changes the earliest readable absolute offset, not the absolute end offset. This makes reconnect/resume byte positions stable during a long session.

## Encoded windows

Chunk descriptors are selected before source bytes. Adjacent source ranges are coalesced, copied into one bounded transferable buffer and rewritten to buffer-local offsets. Protected samples use the same range boundary but require an injected decryptor before clear bytes can enter codec work.

## Composite sources

`CompositeRangeSource` exposes fixed artifacts as one logical source. `LazyCompositeRangeSource` does the same while loading only touched parts and maintaining a bounded part cache. Resumable MP4 finalization uses the lazy form so persisted checkpoint segments are not all fetched from IndexedDB up front.
