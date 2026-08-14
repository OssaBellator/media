# Project format

Media projects serialize as JSON envelopes:

```json
{
  "format": "ossa.media-project",
  "fileVersion": 1,
  "metadata": {},
  "graph": {}
}
```

## Compatibility

- `fileVersion` versions the outer portable file envelope.
- `graph.version` versions graph semantics independently.
- the reader rejects newer unsupported file versions rather than guessing;
- the reader still accepts the original bare graph produced by the first alpha and reports that migration to the caller.

## Media references

Large source media is not embedded in `.media.json`. Assets can use a stable locator such as:

```text
media://asset/asset_<uuid>
```

The locator identifies a project asset, not a machine filesystem path. In the browser Studio the current locator is resolved against IndexedDB. On another machine it is expected to be offline until relinked.

Exports include a metadata asset manifest containing IDs, names, media type, dimensions/duration where known and sampled source fingerprints. This is intended to support future relink/package tooling.

## Rules

1. Never serialize browser `blob:` URLs as source identity.
2. Do not require private local filesystem paths for project validity.
3. Unknown future versions fail loudly.
4. Source media may be missing while graph structure remains valid.
5. Project graph semantics should remain renderer-neutral.
