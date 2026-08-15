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

## Shared trust registry

`media.trust-registry.v1` adds the persistent actor/key/replay policy used by collaboration and distributed rendering. Keys have explicit purpose scopes, validity windows and monotonic revocation. `TrustRegistrySession` verifies a signature before consuming its nonce and persists the next registry revision before returning success; concurrent duplicate nonces serialize so only one can be accepted.

`operationBatchTrustVerifier(session)` plugs directly into the existing operation-batch `verifySignature` callback without changing signed bytes. Studio's `media-studio-trust` IndexedDB store persists registry revisions with compare-and-swap, so nonce consumption and revocation survive reload and stale tabs cannot overwrite newer trust state.

For coordinators that need application-level atomicity, `prepareTrustedMessageVerification()` verifies the actor/key/domain/signature and returns a proposed replay-state revision without persisting it. That proposed registry can be committed in the same coordinator transaction as the accepted graph/log or render-job transition.
`TrustedTransitionSession` packages that ordering into a serialized verify → application transition → atomic persist → publish session, so conflict responses and accepted graph/log transitions can share the same replay-state commit discipline.

## Atomic collaboration coordinator

`CollaborationCoordinatorSession` is the transport-independent ingress boundary for signed collaboration batches. It wraps `TrustedTransitionSession`, derives the exact `media.operation-batch.v1` signing context, and commits trust replay state together with graph/log state through one injected persistence callback.

For a batch anchored at the current journal head, the coordinator applies each validated transaction with the normal graph operation engine, appends the already-signed operation-log entries, validates the resulting checksum chain, then publishes graph/log/trust state only after the atomic persistence callback succeeds. Signature failure never invokes the graph transition, and application or persistence failure leaves both the project and nonce state unchanged.

For authenticated stale/forked input, the coordinator runs the existing deterministic rebase/conflict classifier and leaves graph/log state unchanged. The authenticated request nonce is still committed with that response, preventing replay of the same signed request. `rebase-safe` remains a proposal only: the client must rebuild against the current head and sign a new batch.

The coordinator intentionally defines no socket, HTTP route or account session. A future transport adapter should parse bounded envelopes, call this single ingress method, and serialize the returned `applied`, `rebase-safe`, `conflict`, `different-base` or `different-history` result without acquiring independent mutation authority.

## Bounded collaboration wire protocol

`packages/core/src/collaboration-wire.js` defines `media.collaboration-wire.v1` as a deterministic byte-envelope around the coordinator. The initial request type is `batch.submit`; it carries a bounded request ID and one already-signed `media.operation-batch.v1`. The parser accepts only UTF-8 JSON, rejects unknown top-level fields, applies a configurable request-byte ceiling and validates the signed batch structure before any submit callback is invoked.

`submitCollaborationWirePayload()` turns a coordinator-style submit function into a transport result with an HTTP-compatible status code plus canonical JSON bytes. Successful responses expose the result status, current log head and bounded conflict coordinates/resources, but deliberately strip the original operation bodies from conflict diagnostics. Authentication failures return a generic rejection, replay-policy failures map separately, and unknown application/persistence errors are left to the hosting transport rather than being mislabeled as client errors.

The wire module still opens no socket. HTTP and WebSocket servers should be thin adapters around these bytes and the single `CollaborationCoordinatorSession.submit()` ingress path.

## HTTP request adapter

`packages/core/src/collaboration-http.js` adapts standard Web `Request` objects to the bounded wire submitter and returns standard `Response` objects. It is deliberately a handler factory, not a listener: the static Studio development server remains read-only.

The adapter accepts only the configured collaboration path and `POST application/json`, rejects cross-origin requests by default, and supports explicit CORS allowlists with bounded `OPTIONS` preflight. An injected `authorizeRequest()` hook runs on the real POST before any body bytes are consumed; this is the seam for account/session or bearer-token policy and is separate from the operation-batch actor signature. Request bodies are streamed with a hard byte ceiling, response bodies inherit the wire response ceiling, and unknown application/persistence exceptions become generic 500 errors with no internal detail.

Origin checks are transport hygiene, not actor authentication. Deployments still need a real administrative/account authorization system behind `authorizeRequest()` and should expose the handler only through TLS and their normal service perimeter.

## HTTP client and resolution actions

`packages/core/src/collaboration-client.js` is the matching bounded fetch client. It creates the signed wire request, performs exactly one POST attempt, stream-bounds the response, requires `application/json`, parses the strict wire response schema and correlates successful results to the original request ID. Generic server errors may omit a request ID only when the server rejected bytes before it could parse the envelope.

The client deliberately has **no automatic retry**. Once a coordinator may have consumed the batch nonce and committed the operation, a lost HTTP response is an ambiguous-delivery condition; resending the identical signed batch would be a replay. Callers must reconcile current project/log state before deciding whether to issue a newly signed request.

`collaborationResultAction()` converts server result statuses into UI intent without changing history: `applied` → `accepted`, `rebase-safe` → `resign`, `conflict` → `resolve`, and `different-base`/`different-history` → `refresh`. It does not rebase, alter operations or create a new signature.

## Deliberate boundary

This is not yet a complete collaboration protocol. Media does **not** yet define network transport, account/session authentication, authenticated administrative enrollment UI, presence, permissions or server persistence. Key distribution/rotation and account authorization remain deployment responsibilities.

Distributed render workers reuse the same actor/key trust vocabulary in `media.render-worker.v1`. Signed claim and completion messages bind a specific chunk attempt to that identity, and completion requires an injected verifier for the signed SHA-256 artifact descriptor before render state can transition. `renderWorkerTrustVerifier(session)` applies the same durable key/replay registry to those messages. Coordinator transport and coordinator/application atomic persistence remain follow-on work.

## Causal conflict classification

`packages/core/src/operation-conflicts.js` classifies stale signed batches without silently changing their authenticated content. It maps the current operation vocabulary to deterministic write resources: whole-node add/remove, shallow node fields and individual `props` keys, edge identities and endpoint link sets. Unknown/custom operations are global conflicts.

`analyzeOperationBatchRebase()` first proves the batch's signed prior head is an actual prefix of the local log. Local entries after that head are then compared with the remote transactions. The result is `current`, `rebase-safe`, `conflict`, `different-base` or `different-history` and conflict results carry local/remote sequence, transaction and operation indexes for a future resolution UI.

A `rebase-safe` result is only a proposal: the returned transactions must be rebuilt against the new head and signed again by the actor. Media never rewrites a signed batch or treats its old signature as valid for a rebased history.
