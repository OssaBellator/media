import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRenderJobPlan } from '../src/render-jobs.js';
import { createRenderClaimRequest, signRenderWorkerMessage } from '../src/render-worker-auth.js';
import { RENDER_WORKER_WIRE_SCHEMA } from '../src/render-worker-wire.js';
import { submitRenderWorkerMessageHttp, RenderWorkerClientError } from '../src/render-worker-client.js';
const job = createRenderJobPlan({ signature: 'client-job', settings: { fps: 30, rangeStart: 0, rangeEnd: 1 }, dependencies: [] }, { chunkFrames: 30 });
const sign = async ({ bytes }) => createHmac('sha256', 'client').update(bytes).digest('hex');
async function message(nonce = 'client') { return signRenderWorkerMessage(createRenderClaimRequest(job, { actorId: 'worker', keyId: 'k1', issuedAt: 1000, nonce }), { sign }); }
function result(requestId = 'req') { return { schema: RENDER_WORKER_WIRE_SCHEMA, type: 'worker.result', requestId, action: 'claim', verified: true, committed: true, jobId: job.id, chunkId: job.chunks[0].id, index: 0, attempt: 1, artifactIntegrity: null }; }
function response(value, { status = 200, contentType = 'application/json' } = {}) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': contentType } }); }

test('HTTP client sends one signed request and returns correlated worker result', async () => {
  const calls = [];
  const output = await submitRenderWorkerMessageHttp(await message(), { requestId: 'req', fetchImpl: async (endpoint, init) => { calls.push({ endpoint, init }); return response(result('req')); } });
  assert.equal(calls.length, 1); assert.equal(calls[0].init.method, 'POST'); assert.equal(calls[0].init.headers.get('content-type'), 'application/json');
  assert.equal(output.action, 'claim'); assert.equal(output.requestId, 'req');
});

test('network failure is unknown delivery and is never retried', async () => {
  let calls = 0;
  const signed = await message('network');
  await assert.rejects(() => submitRenderWorkerMessageHttp(signed, { requestId: 'network', fetchImpl: async () => { calls++; throw new Error('socket lost'); } }), (error) => error instanceof RenderWorkerClientError && error.code === 'network-unknown-delivery' && /do not automatically retry/.test(error.message));
  assert.equal(calls, 1);
});

test('client rejects mismatched correlated responses', async () => {
  const signed = await message('mismatch');
  await assert.rejects(() => submitRenderWorkerMessageHttp(signed, { requestId: 'expected', fetchImpl: async () => response(result('other')) }), (error) => error.code === 'response-mismatch');
});

test('typed server error preserves stable wire code but not hidden transport state', async () => {
  const value = { schema: RENDER_WORKER_WIRE_SCHEMA, type: 'error', requestId: 'err', code: 'state-rejected', message: 'Render worker state rejected' };
  const signed = await message('error');
  await assert.rejects(() => submitRenderWorkerMessageHttp(signed, { requestId: 'err', fetchImpl: async () => response(value, { status: 409 }) }), (error) => error.code === 'state-rejected' && error.statusCode === 409);
});

test('uncorrelated early server error with null request ID remains a typed server error', async () => {
  const value = { schema: RENDER_WORKER_WIRE_SCHEMA, type: 'error', requestId: null, code: 'ERR_RENDER_WORKER_WIRE_JSON', message: 'Render worker request must be valid UTF-8 JSON' };
  const signed = await message('early');
  await assert.rejects(() => submitRenderWorkerMessageHttp(signed, { requestId: 'early', fetchImpl: async () => response(value, { status: 400 }) }), (error) => error.code === 'ERR_RENDER_WORKER_WIRE_JSON');
});

test('client rejects wrong content type and oversized declared response before parsing', async () => {
  const typeSigned = await message('type');
  await assert.rejects(() => submitRenderWorkerMessageHttp(typeSigned, { requestId: 'type', fetchImpl: async () => response(result('type'), { contentType: 'text/plain' }) }), (error) => error.code === 'invalid-response-content-type');
  const oversized = new Response(JSON.stringify(result('size')), { status: 200, headers: { 'content-type': 'application/json', 'content-length': '999' } });
  const sizeSigned = await message('size');
  await assert.rejects(() => submitRenderWorkerMessageHttp(sizeSigned, { requestId: 'size', maxResponseBytes: 32, fetchImpl: async () => oversized }), (error) => error.code === 'response-too-large');
});
