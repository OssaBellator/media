# Cut runtime integration — 0.16

Cut's modern playback stack is now assembled behind `createCutPlaybackRuntime()` and owned by `CutPlaybackSession`.

A request is identified by immutable graph object identity, mode and millisecond playhead time. The graph's `version` field is not used for request identity because it represents the graph schema version. Immutable graph edits naturally receive a new runtime identity; explicit invalidation handles source/relink changes.

Scrub requests own an `AbortController`; a newer scrub cancels the older interactive decode/render path. Playback retains composition latest-generation commit semantics. Graph invalidation resets fidelity without discarding source decode state by default, while source invalidation clears range/decode caches and `invalidateAsset()` targets a relinked source.

The compatibility bootstrap still discovers the graph through IndexedDB and time through the existing DOM timecode. It now delegates media state to the session. `installCutPlaybackBridge()` exposes direct API/event hooks for the subsequent editor-owned migration.
