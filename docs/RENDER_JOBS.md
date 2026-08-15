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

The artifact verifier is intentionally injected. `media.trust-registry.v1` can supply the worker signature/replay policy through `renderWorkerTrustVerifier(session)`, including render-worker purpose scope, key validity/revocation, freshness and durable nonce consumption. The registry stores verification descriptors rather than private signing material.

For coordinators that must commit replay state with render-job state atomically, `prepareTrustedMessageVerification()` returns a verified proposed registry without persisting it; the coordinator can commit that registry beside the accepted claim/completion transition in one application transaction.

## Boundary

The final assembly index is intentionally independent of storage implementation so native/cloud renderers can use the same job state and byte/time segment contract. A production distributed renderer still needs coordinator/network transport, artifact upload/storage, administrative key enrollment/account authorization, scheduler policy and coordinator/application atomic persistence.
