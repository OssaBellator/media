# Resumable render jobs

Render jobs are deterministic state machines keyed by the Deliver manifest signature.

Each chunk contains frame/time bounds, attempts, worker ownership and an artifact reference. State transitions are:

```text
pending -> running -> complete
              |\
              | -> pending   (retry/interruption)
              -> failed      (attempts exhausted)
```

A user cancellation uses `releaseRenderChunk()` and, by default, restores the claimed attempt. Decoder/encoder/render failures use normal retry accounting.

Studio stores:

- the render-job state;
- one fMP4 initialization artifact;
- one media-segment artifact per completed chunk.

On startup/resume, interrupted `running` chunks recover to pending, while completed chunks remain immutable and are skipped.

## Authenticated remote workers

`packages/core/src/render-worker-auth.js` adds an additive remote-worker trust boundary without changing local in-process rendering.

`media.render-worker.v1` claim messages bind the render job, the exact next eligible chunk/index, the expected attempt number, actor ID, key ID and optional freshness/nonce fields. The coordinator verifies the injected signature/replay policy before `claimNextRenderChunk()` can transition state. Authenticated claims persist `workerKeyId` and the claim attestation alongside the existing `workerId`.

Completion attestations bind the same actor/key to the active chunk attempt plus a JSON artifact descriptor and SHA-256 integrity descriptor. `completeAuthenticatedRenderChunk()` requires:

1. a valid worker signature and policy checks;
2. exact job/chunk/attempt binding;
3. the same actor and key that own the running chunk;
4. an injected artifact verifier that confirms the uploaded/stored artifact matches the signed integrity descriptor.

Only then does the existing `completeRenderChunk()` transition run. Release, retry and interrupted-recovery paths clear `workerId`, `workerKeyId` and claim-attestation state together so stale authenticated ownership cannot survive a reset.

The artifact verifier is intentionally injected. `media.trust-registry.v1` supplies purpose-scoped worker key enrollment/validity/revocation, freshness and durable nonce policy without storing private signing material.

## Atomic coordinator

`packages/core/src/render-worker-coordinator.js` wraps a map of render jobs plus one shared trust registry in `TrustedTransitionSession`. Signed claim/completion messages are verified once against the shared `render-worker` trust domain, then the existing authenticated render-worker helpers enforce job/chunk/attempt/owner/artifact rules inside the transition.

The application supplies one atomic `persist({ trustRegistry, jobs })` callback. Successful claims and completions therefore publish job state and consumed replay nonce together. Bad signatures, unknown/stale job state, ownership failures, artifact verification failures and persistence failures publish neither state. When no durable transition occurred, the exact same signed message can be retried after the underlying state/storage issue is corrected.

Multiple jobs deliberately share one coordinator serialization boundary so two concurrent workers cannot race the same replay registry even when they target different render jobs.

## Bounded transport boundary

`media.render-worker-wire.v1` wraps one signed `media.render-worker.v1` message with a bounded request ID. Parsing is strict UTF-8/JSON with explicit byte ceilings and no unknown top-level fields. Successful responses expose only the action, job/chunk coordinate, attempt/index, commit state and completion integrity; they do not return the job object, artifact descriptor, worker signature, trust registry or key record. Authentication, replay, state and artifact failures are mapped to stable coarse errors rather than verifier/storage internals.

`createRenderWorkerHttpHandler()` is a listener-neutral Web `Request` → `Response` adapter. It defaults to same-origin, supports explicit bounded CORS preflight, runs an injected account/session authorization hook before reading the body, streams under a hard request limit and emits generic internal-error responses.

`submitRenderWorkerMessageHttp()` is the matching bounded client. Each signed message is sent exactly once. A network or abort failure is reported as **unknown delivery** and the client does not automatically retry, because the server may already have atomically consumed that message nonce and committed its render transition.

None of these modules starts a socket or HTTP listener.

## Boundary

The final assembly index remains independent of storage implementation so native/cloud renderers can use the same job state and byte/time segment contract. A production distributed renderer still needs:

- a durable coordinator datastore implementing the atomic `{ trustRegistry, jobs }` commit callback;
- artifact upload/storage and a verifier that proves stored bytes match the signed SHA-256 descriptor;
- scheduler/worker discovery and retry policy around creation of **new** signed claim/completion messages;
- a host HTTP/WebSocket listener, TLS/session authentication and deployment authorization policy;
- administrative identity/key enrollment, rotation and revocation operations.

Those deployment services must preserve the core no-retry rule for an ambiguously delivered signed worker message.
