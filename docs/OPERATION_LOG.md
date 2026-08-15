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

`saveStoredGraphWithOperation(graph, entry)` opens one read/write transaction spanning `workspace` and `journal`. `saveStoredGraphWithOperationAndAssets(graph, entry, assetWrites)` extends that same transaction to the `assets` store. Before writing either path verifies:

1. the entry schema and deterministic checksum;
2. that `sequence` is exactly the checkpoint sequence plus one;
3. that `previousChecksum` matches the checkpoint head.

When asset writes are supplied, each Blob record, the journal entry and the graph checkpoint commit in one IndexedDB transaction. A crash cannot expose a completed graph/journal edit without its imported or replacement source Blob, or vice versa.

The workspace record retains both the latest graph and `journalBaseGraph`. `loadStoredOperationRecovery()` loads the base graph, current graph and ordered journal, validates the complete checksum chain, and verifies that the journal head exactly matches the graph checkpoint metadata.

The legacy `saveStoredGraph(graph)` path deliberately starts a new journal base: it clears old entries and stores the supplied graph as both the current and base checkpoint at sequence zero. This keeps recovery resets from leaving an apparently valid journal attached to an unrelated graph.

## Studio adoption

`app.js` owns a `HistoryJournalSession`. Normal `applyEdit` operations and Agent plans append compact operation transactions; undo/redo use replayable history checkpoints; media import uses a serialized graph factory checkpoint that preserves undo history; project open uses a replacement checkpoint. Bootstrap validates and replays the stored journal before rendering. If the journal is damaged but the atomically stored graph checkpoint still passes project invariants, Studio preserves that latest graph, resets the damaged journal to a new base, and reports the recovery in activity state.

Media import and relink carry Blob writes as an out-of-band `persistContext`. Blob data never enters transaction metadata or the checksum payload. The context reaches the storage layer only at commit time, where `workspace`, `journal` and `assets` are opened in one read/write transaction. Object URLs and decode-cache invalidation happen only after the durable commit succeeds.

A future collaboration protocol will need authenticated actor identity, causal ordering/conflict semantics and stronger integrity/authenticity than this local corruption checksum.

## Studio journal session

`apps/studio/project-journal-session.js` packages the ordering rules needed by the editor without owning DOM state. Normal commits run `createTransaction` → `applyTransaction` → append journal entry → atomic persistence, and only advance the in-memory graph/log after persistence succeeds. Concurrent calls are serialized so two UI/agent edits cannot race the same sequence number.

Non-JSON persistence context is explicitly out-of-band: `commit()` and `checkpoint()` pass it to the persistence callback but never place it in the operation-log transaction. This is the boundary used for Blob writes and can later carry other local persistence resources without making replay nondeterministic.

History navigation and project replacement are not naturally invertible operation batches in the current snapshot-based `history.js`. For those transitions the session provides an explicit checkpoint entry containing the target graph. Checkpoints use the same checksum chain and atomic persistence path, and replay recognizes them deterministically. They are intended for undo/redo/import/reset boundaries; ordinary edits should continue to record compact operation transactions.

`recoverProjectJournalSession()` replays the base graph through operation and checkpoint entries and refuses to start if the replayed graph differs from the stored current checkpoint.

## Snapshot history adapter

`apps/studio/history-journal-session.js` bridges the durable project journal to Studio's existing snapshot `History` model. `edit()` waits for the operation entry and graph checkpoint to persist before calling the history commit function. `undo()` and `redo()` compute the candidate snapshot first, persist it as a checkpoint entry, and only then switch the visible history. Empty undo/redo moves are true no-ops and do not consume journal sequence numbers.

`commitGraphFactory()` evaluates direct-graph changes against the latest serialized history and forwards persistence options out-of-band. This is used by media import so concurrent editor activity cannot make an analyzed import overwrite a newer graph. `replace()` is the corresponding boundary for project-open/reset-style replacement.

Recovery verifies the journal through `ProjectJournalSession` and intentionally restarts the ephemeral undo stack from the recovered current graph.
