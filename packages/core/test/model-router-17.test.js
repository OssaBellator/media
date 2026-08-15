import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_MODEL_ROUTER_OPTIONS_BYTES,
  MAX_MODEL_ROUTING_BACKEND_ID_CHARS,
  MAX_MODEL_ROUTING_BACKEND_IDS,
  ModelRouter,
  ModelUnsupportedError,
  createModelBackend,
  unsupportedModelResult,
} from '../src/model-router.js';

test('model router deterministically ranks operation-capable backends by priority', () => {
  const router = new ModelRouter()
    .register({ id: 'b', operations: ['plan'], priority: 5, invoke: async () => 'b' })
    .register({ id: 'a', operations: ['plan'], priority: 5, invoke: async () => 'a' })
    .register({ id: 'image', operations: ['generate-image'], priority: 100, invoke: async () => 'image' });
  assert.deepEqual(router.list('plan').map((backend) => backend.id), ['a', 'b']);
});

test('model router falls through explicit unsupported results but not real backend failures', async () => {
  const calls = [];
  const router = new ModelRouter()
    .register({ id: 'first', operations: ['plan'], priority: 10, invoke: async () => { calls.push('first'); return unsupportedModelResult('no-context-window'); } })
    .register({ id: 'second', operations: ['plan'], priority: 1, invoke: async () => { calls.push('second'); return { summary: 'ok', operations: [] }; } });
  const routed = await router.execute('plan', {});
  assert.equal(routed.backendId, 'second');
  assert.deepEqual(calls, ['first', 'second']);
  assert.equal(routed.attempts[0].reason, 'no-context-window');

  const failing = new ModelRouter()
    .register({ id: 'broken', operations: ['plan'], priority: 10, invoke: async () => { throw new Error('provider outage'); } })
    .register({ id: 'fallback', operations: ['plan'], invoke: async () => 'unsafe fallback' });
  await assert.rejects(() => failing.execute('plan', {}), (error) => error.message === 'provider outage' && error.modelBackendId === 'broken');
});

test('model routing policy enforces locality trust cost allow and deny constraints', () => {
  const router = new ModelRouter()
    .register({ id: 'local', operations: ['edit-image'], location: 'local', costTier: 0, priority: 1, invoke: async () => {} })
    .register({ id: 'trusted', operations: ['edit-image'], location: 'remote', trusted: true, costTier: 2, priority: 20, invoke: async () => {} })
    .register({ id: 'remote', operations: ['edit-image'], location: 'remote', trusted: false, costTier: 1, priority: 30, invoke: async () => {} });
  assert.deepEqual(router.list('edit-image', { dataPolicy: 'local' }).map((item) => item.id), ['local']);
  assert.deepEqual(router.list('edit-image', { dataPolicy: 'trusted' }).map((item) => item.id), ['trusted', 'local']);
  assert.deepEqual(router.list('edit-image', { maxCostTier: 1 }).map((item) => item.id), ['remote', 'local']);
  assert.deepEqual(router.list('edit-image', { allowedBackendIds: ['trusted', 'local'], deniedBackendIds: ['trusted'] }).map((item) => item.id), ['local']);
  assert.equal(router.list('edit-image', { preferLocal: true })[0].id, 'local');
});

test('model routing policy rejects unknown, mistyped and oversized fields without coercion', () => {
  const router = new ModelRouter().register({ id: 'local', operations: ['plan'], location: 'local', invoke: async () => {} });
  assert.throws(() => router.list('plan', { preferLocal: 'false' }), /preferLocal must be a boolean/);
  assert.throws(() => router.list('plan', { maxCostTier: 4 }), /maxCostTier must be an integer between 0 and 3/);
  assert.throws(() => router.list('plan', { maxCostTier: 1.5 }), /maxCostTier must be an integer between 0 and 3/);
  assert.throws(() => router.list('plan', { allowedBackendIds: 'local' }), /allowedBackendIds must be an array/);
  assert.throws(() => router.list('plan', { allowedBackendIds: [1] }), /allowedBackendIds must contain non-empty string ids/);
  assert.throws(() => router.list('plan', { allowedBackendIds: Array.from({ length: MAX_MODEL_ROUTING_BACKEND_IDS + 1 }, (_, index) => `b-${index}`) }), /exceeds 256 ids/);
  assert.throws(() => router.list('plan', { deniedBackendIds: ['x'.repeat(MAX_MODEL_ROUTING_BACKEND_ID_CHARS + 1)] }), /id exceeds 160 characters/);
  assert.throws(() => router.list('plan', { preferRemote: true }), /Unsupported model routing policy field: preferRemote/);
  assert.throws(() => router.list('plan', { unsafe: 1n }), /Model routing policy must be JSON-safe/);
  assert.throws(() => router.list('plan', { unknown: 'x'.repeat(MAX_MODEL_ROUTER_OPTIONS_BYTES + 1) }), /Model routing policy.*exceeds 65536 bytes/);
});

test('model routing policy and execution context reject accessors without executing them', async () => {
  let policyGetterCalls = 0;
  const policy = {};
  Object.defineProperty(policy, 'preferLocal', { enumerable: true, get() { policyGetterCalls += 1; return true; } });
  const router = new ModelRouter().register({ id: 'one', operations: ['plan'], invoke: async () => ({ summary: 'ok', operations: [] }) });
  assert.throws(() => router.list('plan', policy), /Model routing policy must be JSON-safe/);
  assert.equal(policyGetterCalls, 0);

  let contextGetterCalls = 0;
  let backendCalls = 0;
  const context = {};
  Object.defineProperty(context, 'secret', { enumerable: true, get() { contextGetterCalls += 1; return 'leak'; } });
  const routed = new ModelRouter().register({ id: 'backend', operations: ['plan'], invoke: async () => { backendCalls += 1; return {}; } });
  await assert.rejects(() => routed.execute('plan', {}, { context }), /Model execution context must be JSON-safe/);
  assert.equal(contextGetterCalls, 0);
  assert.equal(backendCalls, 0);
});

test('model router passes a bounded detached execution context to the backend', async () => {
  let received = null;
  let calls = 0;
  const router = new ModelRouter().register({ id: 'one', operations: ['plan'], invoke: async (_operation, _input, options) => { calls += 1; received = options.context; return {}; } });
  const context = { request: { mode: 'safe' }, values: [1, 2] };
  await router.execute('plan', {}, { context });
  assert.deepEqual(received, context);
  assert.notEqual(received, context);
  assert.notEqual(received.request, context.request);
  await assert.rejects(() => router.execute('plan', {}, { context: { huge: 'x'.repeat(MAX_MODEL_ROUTER_OPTIONS_BYTES + 1) } }), /Model execution context.*exceeds 65536 bytes/);
  assert.equal(calls, 1);
});

test('model router reports bounded unsupported attempt provenance', async () => {
  const router = new ModelRouter().register({ id: 'one', operations: ['transcribe'], invoke: async () => unsupportedModelResult('language') });
  await assert.rejects(() => router.execute('transcribe', {}), (error) => error instanceof ModelUnsupportedError && error.code === 'MODEL_UNSUPPORTED' && error.attempts[0].backendId === 'one');
});

test('model router honors abort before backend invocation', async () => {
  const controller = new AbortController();
  controller.abort();
  let called = false;
  const router = new ModelRouter().register({ id: 'one', operations: ['embed'], invoke: async () => { called = true; } });
  await assert.rejects(() => router.execute('embed', {}, { signal: controller.signal }), (error) => error.name === 'AbortError');
  assert.equal(called, false);
});

test('model backend validation rejects unknown operations and invalid cost tiers', () => {
  assert.throws(() => createModelBackend({ id: 'x', operations: ['teleport'], invoke() {} }), /Unsupported model operation/);
  assert.throws(() => createModelBackend({ id: 'x', operations: ['plan'], costTier: 4, invoke() {} }), /costTier/);
});
