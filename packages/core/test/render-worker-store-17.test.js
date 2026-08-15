import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRenderJobPlan } from '../src/render-jobs.js';
import { createRenderClaimRequest, signRenderWorkerMessage } from '../src/render-worker-auth.js';
import {
  RENDER_WORKER_COORDINATOR_STORE_SCHEMA,
  RenderWorkerCoordinatorStoreError,
  createRenderWorkerCoordinatorStoreSnapshot,
  openRenderWorkerCoordinatorStoreSession,
  validateRenderWorkerCoordinatorStoreSnapshot,
} from '../src/render-worker-store.js';

const secret = 'store-secret';
function registry() {
  return {
    schema: 'media.trust-registry.v1', revision: 0, metadata: {}, nonces: {},
    actors: { worker: { id: 'worker', status: 'active', enrolledAt: null, revokedAt: null, revocationReason: null, metadata: {}, keys: { k1: { id: 'k1', status: 'active', purposes: ['render-worker'], verification: { secret }, metadata: {}, enrolledAt: null, notBefore: null, expiresAt: null, revokedAt: null, revocationReason: null } } } },
  };
}
function job(signature) { return createRenderJobPlan({ signature, settings: { fps: 30, rangeStart: 0, rangeEnd: 1 }, dependencies: [] }, { chunkFrames: 30 }); }
const sign = async ({ bytes }) => createHmac('sha256', secret).update(bytes).digest('hex');
const verifySignature = async ({ bytes, signature, key }) => createHmac('sha256', key.verification.secret).update(bytes).digest('hex') === signature;
async function claim(value, nonce) { return signRenderWorkerMessage(createRenderClaimRequest(value, { actorId: 'worker', keyId: 'k1', issuedAt: 1000, nonce }), { sign }); }
function memoryStore(initial = null) {
  let snapshot = initial == null ? null : structuredClone(initial);
  const writes = [];
  return {
    writes,
    load: async () => snapshot == null ? null : structuredClone(snapshot),
    compareAndSwap: async ({ expectedRevision, snapshot: next, metadata }) => {
      const currentRevision = snapshot?.revision ?? 0;
      if (currentRevision !== expectedRevision) return { committed: false, currentRevision };
      snapshot = structuredClone(next);
      writes.push({ expectedRevision, snapshot: structuredClone(next), metadata: structuredClone(metadata) });
      return { committed: true, currentRevision: next.revision };
    },
    current: () => snapshot == null ? null : structuredClone(snapshot),
    force(snapshotValue) { snapshot = structuredClone(snapshotValue); },
  };
}
async function open(store, jobs) {
  return openRenderWorkerCoordinatorStoreSession({ load: store.load, compareAndSwap: store.compareAndSwap, initialTrustRegistry: registry(), initialJobs: jobs, verifySignature, verifyArtifact: async () => true, now: () => 1001 });
}

test('store session atomically advances durable CAS revision with claim and replay state', async () => {
  const render = job('store-a'), store = memoryStore(), session = await open(store, { [render.id]: render });
  assert.equal(session.snapshot().revision, 0);
  const result = await session.submit(await claim(render, 'claim-a'));
  assert.equal(result.storeRevision, 1);
  assert.equal(session.snapshot().jobs[render.id].chunks[0].status, 'running');
  assert.equal(session.snapshot().trustRegistry.revision, 1);
  assert.equal(store.current().revision, 1);
  assert.equal(store.current().jobs[render.id].chunks[0].status, 'running');
  assert.equal(store.writes.length, 1);
  assert.equal(store.writes[0].expectedRevision, 0);
  assert.equal(store.writes[0].metadata.type, 'render-worker.claim');
});

test('two coordinator processes cannot overwrite each other and conflicted signed message retries after reload', async () => {
  const first = job('first'), second = job('second'), initial = createRenderWorkerCoordinatorStoreSnapshot({ trustRegistry: registry(), jobs: { [first.id]: first, [second.id]: second } }), store = memoryStore(initial);
  const a = await open(store), b = await open(store);
  await a.submit(await claim(first, 'nonce-first'));
  const secondMessage = await claim(second, 'nonce-second');
  await assert.rejects(() => b.submit(secondMessage), (error) => error.code === 'ERR_RENDER_WORKER_STORE_CONFLICT' && error.reloadRequired === true && error.actualRevision === 1);
  assert.equal(store.current().revision, 1);
  assert.equal(store.current().jobs[second.id].chunks[0].status, 'pending');
  await assert.rejects(() => b.submit(secondMessage), (error) => error.code === 'ERR_RENDER_WORKER_STORE_RELOAD_REQUIRED');
  await b.reload();
  const retried = await b.submit(secondMessage);
  assert.equal(retried.storeRevision, 2);
  assert.equal(store.current().jobs[second.id].chunks[0].status, 'running');
  assert.equal(store.current().trustRegistry.revision, 2);
});

test('ambiguous CAS failure forces reload and prevents unsafe retry of a possibly committed signed message', async () => {
  const render = job('unknown-commit'), initial = createRenderWorkerCoordinatorStoreSnapshot({ trustRegistry: registry(), jobs: { [render.id]: render } }), store = memoryStore(initial);
  let first = true;
  const compareAndSwap = async (args) => {
    const result = await store.compareAndSwap(args);
    if (first) { first = false; throw new Error('database connection dropped after commit'); }
    return result;
  };
  const session = await openRenderWorkerCoordinatorStoreSession({ load: store.load, compareAndSwap, verifySignature, verifyArtifact: async () => true, now: () => 1001 });
  const message = await claim(render, 'unknown-nonce');
  await assert.rejects(() => session.submit(message), (error) => error.code === 'ERR_RENDER_WORKER_STORE_UNKNOWN_COMMIT' && error.reloadRequired === true);
  assert.equal(store.current().revision, 1);
  assert.equal(store.current().jobs[render.id].chunks[0].status, 'running');
  await assert.rejects(() => session.submit(message), (error) => error.code === 'ERR_RENDER_WORKER_STORE_RELOAD_REQUIRED');
  await session.reload();
  await assert.rejects(() => session.submit(message), (error) => error.code === 'ERR_TRUST_REPLAY');
});

test('reload imports externally advanced durable state before accepting further work', async () => {
  const first = job('reload-first'), second = job('reload-second'), store = memoryStore(createRenderWorkerCoordinatorStoreSnapshot({ trustRegistry: registry(), jobs: { [first.id]: first, [second.id]: second } }));
  const a = await open(store), b = await open(store);
  await a.submit(await claim(first, 'reload-a'));
  await b.reload();
  const snapshot = b.snapshot();
  assert.equal(snapshot.revision, 1);
  assert.equal(snapshot.jobs[first.id].chunks[0].status, 'running');
  const result = await b.submit(await claim(second, 'reload-b'));
  assert.equal(result.storeRevision, 2);
});

test('snapshot validation rejects malformed revision, trust state and job map', () => {
  const base = createRenderWorkerCoordinatorStoreSnapshot({ trustRegistry: registry(), jobs: {} });
  assert.equal(base.schema, RENDER_WORKER_COORDINATOR_STORE_SCHEMA);
  assert.throws(() => validateRenderWorkerCoordinatorStoreSnapshot({ ...base, revision: -1 }), (error) => error.code === 'ERR_RENDER_WORKER_STORE_FORMAT');
  assert.throws(() => validateRenderWorkerCoordinatorStoreSnapshot({ ...base, trustRegistry: {} }));
  assert.throws(() => validateRenderWorkerCoordinatorStoreSnapshot({ ...base, jobs: [] }), (error) => error.code === 'ERR_RENDER_WORKER_STORE_FORMAT');
});

test('store protocol rejects malformed compareAndSwap results and requires reload', async () => {
  const render = job('bad-cas');
  const session = await openRenderWorkerCoordinatorStoreSession({ load: async () => createRenderWorkerCoordinatorStoreSnapshot({ trustRegistry: registry(), jobs: { [render.id]: render } }), compareAndSwap: async () => ({ nope: true }), verifySignature, verifyArtifact: async () => true, now: () => 1001 });
  const firstMessage = await claim(render, 'bad-cas-nonce');
  await assert.rejects(() => session.submit(firstMessage), (error) => error.code === 'ERR_RENDER_WORKER_STORE_PROTOCOL' && error.reloadRequired === true);
  const secondMessage = await claim(render, 'another');
  await assert.rejects(() => session.submit(secondMessage), (error) => error.code === 'ERR_RENDER_WORKER_STORE_RELOAD_REQUIRED');
});



test('empty durable store requires explicit initial trust registry bootstrap', async () => {
  await assert.rejects(
    () => openRenderWorkerCoordinatorStoreSession({ load: async () => null, compareAndSwap: async () => true, verifySignature }),
    (error) => error.code === 'ERR_RENDER_WORKER_STORE_BOOTSTRAP' && error.reloadRequired === true,
  );
});

test('unloaded and failed-load sessions fail closed', async () => {
  const sessionPromise = openRenderWorkerCoordinatorStoreSession({ load: async () => { throw new Error('db offline'); }, compareAndSwap: async () => true, verifySignature });
  await assert.rejects(() => sessionPromise, (error) => error instanceof RenderWorkerCoordinatorStoreError && error.code === 'ERR_RENDER_WORKER_STORE_LOAD' && error.reloadRequired === true);
});
