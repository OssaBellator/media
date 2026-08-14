# Project format

Media 0.4 writes project-file envelope version **2**:

```json
{
  "format": "ossa.media-project",
  "fileVersion": 2,
  "metadata": {
    "appVersion": "0.4.0"
  },
  "sources": [
    {
      "id": "asset_...",
      "name": "shot.mov",
      "mediaKind": "video",
      "mimeType": "video/quicktime",
      "size": 123456789,
      "duration": 8.42,
      "width": 3840,
      "height": 2160,
      "hash": "sha256-sampled:..."
    }
  ],
  "graph": {}
}
```

## Versioning

`fileVersion` versions the portable envelope. `graph.version` versions graph semantics independently.

The current reader:

- reads v2 directly;
- migrates v1 envelopes into v2 source-manifest semantics;
- reads the original bare graph from the first alpha;
- rejects newer unsupported versions rather than guessing.

## Source manifest

Large source media is intentionally external to `.media.json`. The `sources` array is a portable discovery/relink manifest, not embedded media.

Graph assets may use a stable locator:

```text
media://asset/asset_<uuid>
```

This is logical source identity, not a filesystem path. In the browser Studio it resolves through IndexedDB. On another machine the source can remain offline until matched/relinked.

Matching prioritizes an exact sampled fingerprint. When fingerprints are unavailable, size/name/MIME/duration provide weaker heuristics.

## Native creative objects

Text and vector shapes live directly in graph layer props; they do not require raster source assets. Their transforms, keyframes and effects serialize with the graph.

## Outputs

Deliver settings are `output` graph nodes targeting compositions. Project files therefore preserve intended outputs and their ranges/codecs/dimensions instead of treating export settings as disposable UI state.

## Rules

1. Never serialize browser `blob:` URLs as durable source identity.
2. Do not require private machine filesystem paths for graph validity.
3. Unknown future versions fail loudly.
4. Missing source media does not invalidate project structure.
5. Native text/vector objects remain editable rather than flattened.
6. Project semantics remain renderer-neutral.
7. File migrations must be explicit and tested.
