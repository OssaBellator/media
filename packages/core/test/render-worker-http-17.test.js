import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRenderJobPlan } from '../src/render-jobs.js';
import { createRenderClaimRequest, signRenderWorkerMessage } from '../src/render-worker-auth.js';
import { createRenderWorkerWireRequest, encodeRenderWorkerWireRequest, parseRenderWorkerWireResponse } from '../src/render-worker-wire.js';
import { createRenderWorkerHttpHandler, DEFAULT_RENDER_WORKER_HTTP_PATH } from '../src/render-worker-http.js';
const job = createRenderJobPlan({ signature: 'http-job', settings: { fps: 30, rangeStart: 0, rangeEnd: 1 }, dependencies: [] }, { chunkFrames: 30 });
const sign = async ({ bytes }) => createHmac('sha256', 'http').update(bytes).digest('hex');
async function body(requestId = 'req-http') {
  const message = await signRenderWorkerMessage(createRenderClaimRequest(job, { actorId: 'worker', keyId: 'k1', issuedAt: 1000, nonce: requestId }), { sign });
  return encodeRenderWorkerWireRequest(createRenderWorkerWireRequest(message, { requestId }));
}
function success() { return { verified: true, committed: true, result: { type: 'claim', jobId: job.id, chunkId: job.chunks[0].id, index: 0, attempt: 1 } }; }

test('HTTP adapter accepts bounded JSON POST and delegates to wire submit', async () => {
  let calls = 0;
  const handler = createRenderWorkerHttpHandler({ submit: async () => { calls++; return success(); } });
  const response = await handler(new Request(`https://media.test${DEFAULT_RENDER_WORKER_HTTP_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: await body() }));
  assert.equal(response.status, 200); assert.equal(calls, 1);
  const parsed = parseRenderWorkerWireResponse(new Uint8Array(await response.arrayBuffer()));
  assert.equal(parsed.action, 'claim');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('HTTP adapter rejects wrong route, method, and content type before delegation', async () => {
  let calls = 0; const handler = createRenderWorkerHttpHandler({ submit: async () => { calls++; return success(); } });
  assert.equal((await handler(new Request('https://media.test/nope', { method: 'POST' }))).status, 404);
  assert.equal((await handler(new Request(`https://media.test${DEFAULT_RENDER_WORKER_HTTP_PATH}`, { method: 'GET' }))).status, 405);
  assert.equal((await handler(new Request(`https://media.test${DEFAULT_RENDER_WORKER_HTTP_PATH}`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' }))).status, 415);
  assert.equal(calls, 0);
});

test('session authorization runs before request body consumption', async () => {
  let pulls = 0, auth = 0;
  const stream = new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new TextEncoder().encode('{}')); controller.close(); } }, { highWaterMark: 0 });
  const handler = createRenderWorkerHttpHandler({ submit: async () => success(), authorizeRequest: async () => { auth++; return false; } });
  const request = new Request(`https://media.test${DEFAULT_RENDER_WORKER_HTTP_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: stream, duplex: 'half' });
  const response = await handler(request);
  assert.equal(response.status, 401); assert.equal(auth, 1); assert.equal(pulls, 0);
});

test('HTTP adapter enforces declared and streamed body byte limits', async () => {
  const handler = createRenderWorkerHttpHandler({ submit: async () => success(), maxBodyBytes: 8 });
  const declared = await handler(new Request(`https://media.test${DEFAULT_RENDER_WORKER_HTTP_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '9' }, body: '123456789' }));
  assert.equal(declared.status, 413);
  const streamed = await handler(new Request(`https://media.test${DEFAULT_RENDER_WORKER_HTTP_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '123456789' }));
  assert.equal(streamed.status, 413);
});

test('cross-origin is denied by default and explicit allowlist emits CORS + preflight', async () => {
  const denied = createRenderWorkerHttpHandler({ submit: async () => success() });
  const deniedResponse = await denied(new Request(`https://media.test${DEFAULT_RENDER_WORKER_HTTP_PATH}`, { method: 'POST', headers: { origin: 'https://worker.test', 'content-type': 'application/json' }, body: await body('cross-denied') }));
  assert.equal(deniedResponse.status, 403);
  const allowed = createRenderWorkerHttpHandler({ submit: async () => success(), allowedOrigins: ['https://worker.test'] });
  const preflight = await allowed(new Request(`https://media.test${DEFAULT_RENDER_WORKER_HTTP_PATH}`, { method: 'OPTIONS', headers: { origin: 'https://worker.test', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type, authorization' } }));
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://worker.test');
  const post = await allowed(new Request(`https://media.test${DEFAULT_RENDER_WORKER_HTTP_PATH}`, { method: 'POST', headers: { origin: 'https://worker.test', 'content-type': 'application/json' }, body: await body('cross-ok') }));
  assert.equal(post.status, 200); assert.equal(post.headers.get('access-control-allow-origin'), 'https://worker.test');
});

test('preflight rejects methods or request headers outside the explicit policy', async () => {
  const handler = createRenderWorkerHttpHandler({ submit: async () => success(), allowedOrigins: ['https://worker.test'] });
  const badHeader = await handler(new Request(`https://media.test${DEFAULT_RENDER_WORKER_HTTP_PATH}`, { method: 'OPTIONS', headers: { origin: 'https://worker.test', 'access-control-request-method': 'POST', 'access-control-request-headers': 'x-secret' } }));
  assert.equal(badHeader.status, 403);
  const badMethod = await handler(new Request(`https://media.test${DEFAULT_RENDER_WORKER_HTTP_PATH}`, { method: 'OPTIONS', headers: { origin: 'https://worker.test', 'access-control-request-method': 'DELETE' } }));
  assert.equal(badMethod.status, 403);
});

test('unknown coordinator failures become generic HTTP 500 without leaking details', async () => {
  const handler = createRenderWorkerHttpHandler({ submit: async () => { throw new Error('secret database path'); } });
  const response = await handler(new Request(`https://media.test${DEFAULT_RENDER_WORKER_HTTP_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: await body('server-fail') }));
  assert.equal(response.status, 500);
  const text = await response.text();
  assert.equal(text.includes('secret database path'), false);
  assert.match(text, /Render worker service error/);
});
