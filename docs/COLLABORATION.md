# Authenticated collaboration foundation

Media's local `media.operation-log.v1` checksum chain detects corruption and preserves deterministic replay, but its 64-bit checksum is not an identity or authenticity boundary. Collaboration therefore authenticates **batches of already-deterministic operation-log entries** rather than changing the local journal format.

## Signed operation batches

`packages/core/src/operation-batch.js` defines `media.operation-batch.v1`.

A batch binds:

- the project ID and journal base revision;
- the exact prior log head (`sequence`, checksum and transaction ID);
- an authenticated actor ID and key ID;
- optional integer `issuedAt` and nonce fields for freshness/replay policy;
- one or more ordinary `media.operation-log.v1` entries;
- an external signature over canonical JSON for all of the fields above.

`createOperationBatch()` derives entries by using the existing immutable append path. `signOperationBatch()` and `verifyOperationBatch()` accept injected signing/verifier callbacks so the core format does not hard-code a deployment PKI, identity provider or browser-specific key store.

The signature covers the full canonical transaction bytes. Recomputing Media's local checksums after changing a transaction is therefore insufficient to forge an authenticated batch.

## Fail-closed replay

`appendAuthenticatedOperationBatch()` verifies structure, checksum continuity, actor policy, optional freshness policy and signature before it compares the batch anchor to the local head and appends anything. A valid signature against an older head is rejected as stale/forked rather than silently rebased.

`replayAuthenticatedOperationBatch()` performs the same validation before invoking the transaction applier. Invalid signatures and stale heads therefore produce zero graph-mutation callbacks.

This gives collaboration a deterministic authenticated ingestion boundary without weakening crash-recovery semantics.

## Deliberate boundary

This is not yet a complete collaboration protocol. Media does **not** yet define network transport, account/session authentication, key enrollment/revocation, causal merge semantics, concurrent-edit conflict resolution, presence, permissions or server persistence. Stale/forked batches fail closed until those policies are explicit.

Distributed render workers should reuse the same actor/key trust vocabulary when worker claims and artifact attestations are authenticated; they should not invent a separate identity model.
