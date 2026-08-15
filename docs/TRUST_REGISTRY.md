# Trust registry and replay state

`media.trust-registry.v1` is the shared identity/key/replay policy for authenticated collaboration and remote render-worker messages.

The registry is intentionally JSON-only. It stores actor records, key IDs, purpose scopes, public/opaque verification descriptors, validity windows, revocation state and consumed nonces. Private signing material does not belong in the registry; the injected signature verifier resolves whatever external key material is required from the stored verification descriptor.

## Enrollment and revocation

Actors and keys are immutable identities. `enrollTrustActor()` and `enrollTrustKey()` create new active records; a revoked actor/key ID cannot be reused. Keys carry explicit purpose scopes such as `collaboration` and `render-worker`, optional `notBefore`/`expiresAt` bounds and arbitrary JSON metadata.

`revokeTrustKey()` and `revokeTrustActor()` are monotonic registry revisions. Actor revocation also revokes every still-active key owned by that actor.

## Persistence-first replay protection

`TrustRegistrySession` serializes all registry changes. It requires a persistence callback and does not publish a new in-memory revision until that callback succeeds.

A verifier created by `session.verifier()` resolves an active actor/key for the requested purpose, checks freshness and domain constraints, rejects already-consumed nonces, verifies the external signature, then persists the nonce-bearing next registry revision before returning success. Invalid signatures do not consume a nonce. Persistence failure does not consume a nonce. Concurrent attempts to reuse one nonce serialize so at most one can succeed.

`prepareTrustedMessageVerification()` exposes the same checks as a pure prepare step. It returns a proposed nonce-consumed registry without mutating or persisting the input. A coordinator that owns both trust and project/job storage can therefore atomically commit the proposed registry beside the accepted application transition instead of consuming replay state before the application write succeeds.

`operationBatchTrustVerifier(session)` is domain-bound to `media.operation-batch.v1` and the `collaboration` purpose. `renderWorkerTrustVerifier(session)` is domain-bound to `media.render-worker.v1`, claim/completion message types and the `render-worker` purpose. They fit the existing `verifySignature` callback surfaces; the signed protocol statements themselves do not change.

Nonce records are scoped by actor, key and purpose and are bounded by retention/entry limits. Deployments should choose a retention window at least as long as their accepted message freshness window.

## Atomic trusted transitions

`TrustedTransitionSession` composes the pure verification step with an application transition and one injected atomic persistence callback. It serializes messages, prepares the nonce-bearing trust revision, runs the transition against a cloned current state, persists `{ trustRegistry, state }` together and only then publishes either value in memory.

This is the coordinator boundary for collaboration and distributed rendering: a graph/log transition, conflict response or render-job transition can share one commit with replay state without changing the signed protocol formats. Transition or persistence failure leaves both in-memory states unchanged.

## Studio durable store

`apps/studio/trust-storage.js` uses a separate `media-studio-trust` IndexedDB database. Registry writes are compare-and-swap on the previous revision, so stale tabs cannot overwrite newer enrollment, revocation or replay state. `createStoredTrustRegistrySession()` wires that durable store directly into `TrustRegistrySession`.

If IndexedDB is unavailable, the durable session fails closed when it attempts to persist enrollment, revocation or a consumed nonce. It does not silently downgrade replay protection to an ephemeral in-memory set.

## Deliberate boundary

This registry is a trust-state primitive, not an identity provider. Production enrollment still needs an authenticated administrative path, key-distribution/rotation policy and account/session authorization. Remote transport must also provide atomic coordinator persistence around the accepted message and any resulting application state transition where required by the deployment consistency model.
