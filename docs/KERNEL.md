# Media kernel

The kernel turns source bytes and evaluated creative intent into deterministic media work without coupling the Universal Creative Graph to browser APIs.

## 0.10 production path

```text
range source
  -> classic MP4 / sparse fMP4 / sparse WebM / live WebM index
  -> encoded windows
  -> codec backend router
       native | WebCodecs | WASM
  -> decoded media
  -> composition render graph
  -> encode
  -> resumable fragments
  -> classic finalization / streaming delivery
```

### Fragmented MP4

The sparse fragment index reads top-level headers, `moov` and individual `moof` boxes. `tfhd/tfdt/trun` information is mapped back to absolute source byte offsets while `mdat` remains unread. The implementation targets common CMAF/default-base-is-moof layouts. Unsupported/ambiguous layouts may use the existing explicit bounded fallback.

### Live WebM

`LiveWebmClusterIndexer` is stateful across source growth. Unknown-size Clusters remain open; partial element/block tails wait for more bytes; completed block ranges are emitted once. It is an indexer over an appendable range source, not a networking protocol.

### Codec backends

Codec work uses `CodecBackendRegistry`. Backends declare operations and priority, may probe support, and return the same kernel-facing results. `ERR_CODEC_UNSUPPORTED` is the only automatic fallback signal by default. Native/WASM implementations are injectable integration points; Media does not ship codec binaries in this repository.

### HDR/GPU

The reference WebGPU graph composes in `rgba16float` and owns an explicit output tone-map pass. Browser source uploads remain capability-gated because structural HDR metadata does not by itself guarantee a scene-linear external-image conversion.
