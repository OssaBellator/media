# Operation log and crash recovery

0.16 introduces a deterministic operation-log foundation for crash-safe project persistence.

## Core log

`packages/core/src/operation-log.js` defines `media.operation-log.v1`.

Each entry contains:

- a one-based monotonic `sequence`;
- the original transaction (`id`, label, operations and JSON metadata);
- the previous entry checksum;
- a deterministic checksum over schema, sequence, transaction and previous checksum.

Canonical JSON sorts object keys and rejects cycles, non-finite numbers, `undefined`, functions and other non-JSON values instead of silently changing them. The checksum chain detects accidental corruption, sequence gaps and local tampering before replay. It is deliberately **not** a cryptographic signature or an authenticity boundary.

The core helpers support append, validation, head inspection, prefix truncation/rebranching and replay through an injected transaction applier. The log is immutable at the API boundary: append/truncate return a new value.

## IndexedDB checkpoint

Studio storage schema v3 adds a `journal` object store keyed by sequence with a unique transaction-id index.

`saveStoredGraphWithOperation(graph, entry)` opens one read/write transaction spanning both `workspace` and `journal`. Before writing it verifies:

1. the entry schema and deterministic checksum;
2. that `sequence` is exactly the checkpoint sequence plus one;
3. that `previousChecksum` matches the checkpoint head.

The journal entry and new graph checkpoint then commit atomically. A crash cannot expose only one half of that pair through a completed IndexedDB transaction.

The workspace record retains both the latest graph and `journalBaseGraph`. `loadStoredOperationRecovery()` loads the base graph, current graph and ordered journal, validates the complete checksum chain, and verifies that the journal head exactly matches the graph checkpoint metadata.

The legacy `saveStoredGraph(graph)` path deliberately starts a new journal base: it clears old entries and stores the supplied graph as both the current and base checkpoint at sequence zero. This keeps imports/resets from leaving an apparently valid journal attached to an unrelated graph.

## Studio adoption and remaining boundary

`app.js` now owns a `HistoryJournalSession`. Normal `applyEdit` operations and Agent plans append compact operation transactions; undo/redo use replayable history checkpoints; media import uses a serialized graph factory checkpoint that preserves undo history; project open uses a replacement checkpoint. Bootstrap validates and replays the stored journal before rendering. If the journal is damaged but the atomically stored graph checkpoint still passes project invariants, Studio preserves that latest graph, resets the damaged journal to a new base, and reports the recovery in activity state.

The next crash-safety boundary is source storage. Media import/relink currently write asset Blobs in the `assets` store separately from the graph+journal transaction. A crash can therefore leave an orphan Blob or a graph checkpoint whose replacement Blob did not commit. The next storage step should allow asset Blob mutations and the graph/journal entry to share one IndexedDB transaction.

A future collaboration protocol will also need authenticated actor identity, causal ordering/conflict semantics and stronger integrity/authenticity than this local corruption checksum.

## Studio journal session

`apps/studio/project-journal-session.js` packages the ordering rules needed by the editor without owning DOM state. Normal commits run `createTransaction` → `applyTransaction` → append journal entry → atomic persistence, and only advance the in-memory graph/log after persistence succeeds. Concurrent calls are serialized so two UI/agent edits cannot race the same sequence number.

History navigation and project replacement are not naturally invertible operation batches in the current snapshot-based `history.js`. For those transitions the session provides an explicit checkpoint entry containing the target graph. Checkpoints use the same checksum chain and atomic persistence path, and replay recognizes them deterministically. They are intended for undo/redo/import/reset boundaries; ordinary edits should continue to record compact operation transactions.

`recoverProjectJournalSession()` replays the base graph through operation and checkpoint entries and refuses to start if the replayed graph differs from the stored current checkpoint.

## Snapshot history adapter

`apps/studio/history-journal-session.js` bridges the durable project journal to Studio's existing snapshot `History` model. `edit()` waits for the operation entry and graph checkpoint to persist before calling the history commit function. `undo()` and `redo()` compute the candidate snapshot first, persist it as a checkpoint entry, and only then switch the visible history. Empty undo/redo moves are true no-ops and do not consume journal sequence numbers.

`replace()` is the corresponding boundary for project open/reset-style graph replacement: it persists a replayable checkpoint and starts a fresh in-memory undo history at that graph while retaining the durable journal chain. Recovery verifies the journal through `ProjectJournalSession` and intentionally restarts the ephemeral undo stack from the recovered current graph.

This adapter is the intended `app.js` integration surface; the large editor file no longer needs to implement journal sequencing, recovery replay, or persistence-failure rollback itself.
