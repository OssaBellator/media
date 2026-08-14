# Media kernel

The kernel turns source bytes and evaluated creative intent into deterministic media work without coupling the Universal Creative Graph to browser APIs.

## 0.11 production path

```text
static / append / lazy range source
  -> classic MP4 / sparse fMP4 / static-live WebM / CMAF session
  -> clear or protected encoded sample descriptors
  -> optional authorized decryptSample boundary
  -> codec backend router
       native | WebCodecs | WASM
  -> decoded media
  -> composition render graph
  -> encode
  -> resumable fragments
  -> streaming classic finalization / progressive delivery
```

## Common Encryption inspection

The fMP4 index can surface protected `encv`/`enca` sample entries and the associated `sinf/schm/tenc`, `senc`, `saiz/saio`, `sgpd(seig)`, `sbgp` and `pssh` information. Per-sample descriptors carry KID, IV, pattern state and subsample ranges where available. Structurally inconsistent subsample maps are rejected before an injected decryptor is invoked.

This is not a DRM implementation. PSSH data remains opaque initialization metadata and Media never invents keys or silently submits protected bytes to ordinary decoder work.

## Live media

Append sources provide backpressure and pruning. Live WebM indexing survives partial tails. CMAF sessions treat complete media segments as individually evictable sparse sources. Networking is an adapter above these contracts.

## Codec backends

Codec work uses `CodecBackendRegistry`. Backends declare operations/priority, may probe support and return the same kernel-facing results. Unsupported is a capability result; repeated real failures can affect backend health/quarantine state.

## HDR/GPU

The reference graph composes in `rgba16float`. Browser external-image upload and explicit native/WASM linear-half-float upload are separate paths. Linear HDR presentation requires a tone-map policy rather than assuming the output surface understands scene-linear values.
