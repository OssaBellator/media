import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRenderJobPlan } from '../src/render-jobs.js';
import {
  createRenderClaimRequest,
  createRenderCompletionAttestation,
  signRenderWorkerMessage,
} from '../src/render-worker-auth.js';
import { RenderWorkerCoordinatorSession } from '../src/render-worker-coordinator.js';

const secret = 'coordinator-secret';
function registry() {
  return {
    schema: 'media.trust-registry.v1',
    revision: 0,
    metadata: {},
    actors: {
      worker: {
        id: 'worker', status: 'active', enrolledAt: null, revokedAt: null, revocationReason: null, metadata: {},
        keys: {
          k1: { id: 'k1', status: 'active', purposes: ['render-worker'], verification: { secret }, metadata: {}, enrolledAt: null, notBefore: null, expiresAt: null, revokedAt: null, revocationReason: null },
        },
      },
    },
    nonces: {},
  };
}
function job(signature = 'render-a') {
  return createRenderJobPlan({ signature, settings: { fps: 30, rangeStart: 0, rangeEnd: 1 }, dependencies: [] }, { chunkFrames: 30 });
}
const sign = async ({ bytes }) => createHmac('sha256', secret).update(bytes).digest('hex');
const verifySignature = async ({ bytes, signature, key }) => createHmac('sha256', key.verification.secret).update(bytes).digest('hex') === signature;
async function claimMessage(value, nonce = 'claim-1') {
  return signRenderWorkerMessage(createRenderClaimRequest(value, { actorId: 'worker', keyId: 'k1', issuedAt: 1000, nonce }), { sign });
}
async function completionMessage(value, nonce = 'complete-1') {
  const chunk = value.chunks.find((item) => item.status === 'running');
  return signRenderWorkerMessage(createRenderCompletionAttestation(value, chunk.id, { key: 'segment-0', byteLength: 4 }, { actorId: 'worker', keyId: 'k1', artifactIntegrity: 'sha256-AAAA', issuedAt: 1000, nonce }), { sign });
}
function createCoordinator({ jobs, persist = async () => {}, verifyArtifact = async () => true } = {}) {
  return new RenderWorkerCoordinatorSession({ trustRegistry: registry(), jobs, persist, verifySignature, verifyArtifact, now: () => 1001 });
}

test('authenticated claim atomically persists job ownership and consumed replay state', async () => {
  const initial = job(), writes = [];
  const coordinator = createCoordinator({ jobs: { [initial.id]: initial }, persist: async (value, metadata) => writes.push({ value, metadata }) });
  const result = await coordinator.submit(await claimMessage(initial));
  assert.equal(result.verified, true);
  assert.equal(result.committed, true);
  assert.equal(result.result.type, 'claim');
  const chunk = result.jobs[initial.id].chunks[0];
  assert.equal(chunk.status, 'running');
  assert.equal(chunk.workerId, 'worker');
  assert.equal(chunk.workerKeyId, 'k1');
  assert.equal(chunk.claimAttestation.nonce, 'claim-1');
  assert.equal(result.trustRegistry.revision, 1);
  assert.equal(Object.keys(result.trustRegistry.nonces).length, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].metadata.type, 'render-worker.claim');
});

test('replayed claim is rejected after one durable transition', async () => {
  const initial = job(), writes = [];
  const coordinator = createCoordinator({ jobs: { [initial.id]: initial }, persist: async (value) => writes.push(value) });
  const message = await claimMessage(initial, 'same-claim');
  await coordinator.submit(message);
  await assert.rejects(() => coordinator.submit(message), (error) => error.code === 'ERR_TRUST_REPLAY');
  assert.equal(writes.length, 1);
  assert.equal(coordinator.snapshot().jobs[initial.id].chunks[0].attempts, 1);
});

test('completion atomically commits verified artifact and replay nonce', async () => {
  const initial = job(), checks = [], writes = [];
  const coordinator = createCoordinator({ jobs: { [initial.id]: initial }, persist: async (value) => writes.push(value), verifyArtifact: async (context) => { checks.push(context); return true; } });
  await coordinator.submit(await claimMessage(initial, 'claim-complete'));
  const running = coordinator.snapshot().jobs[initial.id];
  const completion = await completionMessage(running, 'complete-ok');
  const result = await coordinator.submit(completion);
  assert.equal(result.result.type, 'complete');
  assert.equal(result.jobs[initial.id].status, 'complete');
  assert.equal(result.jobs[initial.id].chunks[0].artifact.integrity, 'sha256-AAAA');
  assert.equal(result.jobs[initial.id].chunks[0].artifact.workerAttestation.actor.id, 'worker');
  assert.equal(checks.length, 1);
  assert.equal(writes.length, 2);
  assert.equal(result.trustRegistry.revision, 2);
});

test('artifact verification failure consumes no nonce and exact completion can retry', async () => {
  const initial = job(); let allow = false, writes = 0;
  const coordinator = createCoordinator({ jobs: { [initial.id]: initial }, persist: async () => { writes++; }, verifyArtifact: async () => allow });
  await coordinator.submit(await claimMessage(initial, 'claim-artifact'));
  const completion = await completionMessage(coordinator.snapshot().jobs[initial.id], 'artifact-retry');
  await assert.rejects(() => coordinator.submit(completion), (error) => error.code === 'ERR_RENDER_ARTIFACT_INTEGRITY');
  assert.equal(coordinator.snapshot().trustRegistry.revision, 1);
  assert.equal(coordinator.snapshot().jobs[initial.id].chunks[0].status, 'running');
  assert.equal(writes, 1);
  allow = true;
  const result = await coordinator.submit(completion);
  assert.equal(result.jobs[initial.id].status, 'complete');
  assert.equal(result.trustRegistry.revision, 2);
  assert.equal(writes, 2);
});

test('persistence failure publishes neither claim state nor nonce and exact claim can retry', async () => {
  const initial = job(); let fail = true, writes = 0;
  const coordinator = createCoordinator({ jobs: { [initial.id]: initial }, persist: async () => { writes++; if (fail) throw new Error('storage unavailable'); } });
  const message = await claimMessage(initial, 'persist-retry');
  await assert.rejects(() => coordinator.submit(message), /storage unavailable/);
  assert.equal(coordinator.snapshot().trustRegistry.revision, 0);
  assert.equal(coordinator.snapshot().jobs[initial.id].chunks[0].status, 'pending');
  fail = false;
  const result = await coordinator.submit(message);
  assert.equal(result.jobs[initial.id].chunks[0].status, 'running');
  assert.equal(result.trustRegistry.revision, 1);
  assert.equal(writes, 2);
});

test('concurrent duplicate claim messages serialize to one transition and one replay rejection', async () => {
  const initial = job(); let writes = 0;
  const coordinator = createCoordinator({ jobs: { [initial.id]: initial }, persist: async () => { writes++; } });
  const message = await claimMessage(initial, 'concurrent');
  const settled = await Promise.allSettled([coordinator.submit(message), coordinator.submit(message)]);
  assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 1);
  const rejected = settled.find((item) => item.status === 'rejected');
  assert.equal(rejected.reason.code, 'ERR_TRUST_REPLAY');
  assert.equal(writes, 1);
  assert.equal(coordinator.snapshot().jobs[initial.id].chunks[0].attempts, 1);
});

test('bad signature and unknown job produce no durable state or nonce consumption', async () => {
  const initial = job(); let writes = 0;
  const coordinator = createCoordinator({ jobs: { [initial.id]: initial }, persist: async () => { writes++; } });
  const bad = await claimMessage(initial, 'bad-signature'); bad.signature = 'bad';
  const rejected = await coordinator.submit(bad);
  assert.equal(rejected.verified, false);
  assert.equal(rejected.committed, false);
  assert.equal(coordinator.snapshot().trustRegistry.revision, 0);
  const missing = job('not-enrolled');
  const missingMessage = await claimMessage(missing, 'missing-job');
  await assert.rejects(() => coordinator.submit(missingMessage), (error) => error.code === 'ERR_RENDER_WORKER_JOB');
  assert.equal(coordinator.snapshot().trustRegistry.revision, 0);
  assert.equal(writes, 0);
});

test('stale signed claim consumes no nonce and performs no persistence', async () => {
  const initial = job(), stale = structuredClone(initial); let writes = 0;
  stale.chunks[0] = { ...stale.chunks[0], status: 'running', attempts: 1, workerId: 'other', workerKeyId: 'other-key' };
  stale.status = 'running';
  const coordinator = createCoordinator({ jobs: { [stale.id]: stale }, persist: async () => { writes++; } });
  const message = await claimMessage(initial, 'stale-state');
  await assert.rejects(() => coordinator.submit(message), (error) => error.code === 'ERR_RENDER_WORKER_STATE');
  assert.equal(coordinator.snapshot().trustRegistry.revision, 0);
  assert.equal(coordinator.snapshot().jobs[stale.id].chunks[0].workerId, 'other');
  assert.equal(writes, 0);
});

test('multi-job coordinator updates only the message-bound render job', async () => {
  const first = job('first'), second = job('second');
  const coordinator = createCoordinator({ jobs: { [first.id]: first, [second.id]: second } });
  const result = await coordinator.submit(await claimMessage(second, 'second-only'));
  assert.equal(result.jobs[first.id].chunks[0].status, 'pending');
  assert.equal(result.jobs[second.id].chunks[0].status, 'running');
});
