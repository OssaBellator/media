import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRenderJobPlan } from '../src/render-jobs.js';
import { createRenderClaimRequest, signRenderWorkerMessage, RenderWorkerAuthError } from '../src/render-worker-auth.js';
import { TrustRegistryError } from '../src/trust-registry.js';
import {
  RENDER_WORKER_WIRE_SCHEMA,
  createRenderWorkerWireRequest,
  encodeRenderWorkerWireRequest,
  parseRenderWorkerWireRequest,
  parseRenderWorkerWireResponse,
  submitRenderWorkerWirePayload,
} from '../src/render-worker-wire.js';
const job = createRenderJobPlan({ signature: 'wire-job', settings: { fps: 30, rangeStart: 0, rangeEnd: 1 }, dependencies: [] }, { chunkFrames: 30 });
const sign = async ({ bytes }) => createHmac('sha256', 'wire').update(bytes).digest('hex');
async function claim() { return signRenderWorkerMessage(createRenderClaimRequest(job, { actorId: 'worker', keyId: 'k1', issuedAt: 1000, nonce: 'wire-nonce' }), { sign }); }

test('wire request round-trips a signed worker message under a bounded request ID', async () => {
  const message = await claim(), request = createRenderWorkerWireRequest(message, { requestId: 'req-1' }), bytes = encodeRenderWorkerWireRequest(request), parsed = parseRenderWorkerWireRequest(bytes);
  assert.equal(parsed.requestId, 'req-1');
  assert.equal(parsed.message.signature, message.signature);
  assert.equal(parsed.message.chunk.id, job.chunks[0].id);
});

test('wire request rejects oversized, unknown-field, or malformed signed messages', async () => {
  const message = await claim(), request = createRenderWorkerWireRequest(message, { requestId: 'req-2' });
  await assert.rejects(async () => parseRenderWorkerWireRequest(encodeRenderWorkerWireRequest(request), { maxBytes: 5 }), (error) => error.statusCode === 413);
  assert.throws(() => parseRenderWorkerWireRequest(JSON.stringify({ ...request, extra: true })), /Unsupported render worker envelope field/);
  assert.throws(() => parseRenderWorkerWireRequest(JSON.stringify({ ...request, message: { ...message, signature: null } })), /malformed/);
});

test('wire submit returns sanitized claim coordinates without job, trust, or signature state', async () => {
  const message = await claim(), request = createRenderWorkerWireRequest(message, { requestId: 'req-3' });
  const output = await submitRenderWorkerWirePayload(encodeRenderWorkerWireRequest(request), { submit: async () => ({ verified: true, committed: true, result: { type: 'claim', jobId: job.id, chunkId: job.chunks[0].id, index: 0, attempt: 1 }, jobs: { secret: true }, trustRegistry: { secret: true } }) });
  assert.equal(output.statusCode, 200);
  const parsed = parseRenderWorkerWireResponse(output.body);
  assert.equal(parsed.action, 'claim');
  assert.equal(parsed.artifactIntegrity, null);
  const text = new TextDecoder().decode(output.body);
  assert.equal(text.includes('signature'), false);
  assert.equal(text.includes('trustRegistry'), false);
  assert.equal(text.includes('jobs'), false);
});

test('wire submit maps authentication and replay failures to stable coarse errors', async () => {
  const request = createRenderWorkerWireRequest(await claim(), { requestId: 'req-4' }), bytes = encodeRenderWorkerWireRequest(request);
  const auth = await submitRenderWorkerWirePayload(bytes, { submit: async () => ({ verified: false, committed: false }) });
  assert.equal(auth.statusCode, 401);
  assert.equal(auth.response.code, 'authentication-rejected');
  const replay = await submitRenderWorkerWirePayload(bytes, { submit: async () => { throw new TrustRegistryError('seen', { code: 'ERR_TRUST_REPLAY' }); } });
  assert.equal(replay.statusCode, 409);
  assert.equal(replay.response.code, 'replay-rejected');
});

test('wire submit maps render state and artifact failures without leaking internal messages', async () => {
  const request = createRenderWorkerWireRequest(await claim(), { requestId: 'req-5' }), bytes = encodeRenderWorkerWireRequest(request);
  const state = await submitRenderWorkerWirePayload(bytes, { submit: async () => { throw new RenderWorkerAuthError('secret owner detail', { code: 'ERR_RENDER_WORKER_OWNER' }); } });
  assert.equal(state.statusCode, 409);
  assert.equal(state.response.code, 'state-rejected');
  assert.equal(state.response.message.includes('secret'), false);
  const artifact = await submitRenderWorkerWirePayload(bytes, { submit: async () => { throw new RenderWorkerAuthError('secret storage path', { code: 'ERR_RENDER_ARTIFACT_INTEGRITY' }); } });
  assert.equal(artifact.statusCode, 422);
  assert.equal(artifact.response.code, 'artifact-rejected');
  assert.equal(artifact.response.message.includes('storage'), false);
});

test('completion result exposes only signed integrity and bounded coordinates', async () => {
  const message = await claim(), request = createRenderWorkerWireRequest(message, { requestId: 'req-6' }), output = await submitRenderWorkerWirePayload(encodeRenderWorkerWireRequest(request), { submit: async () => ({ verified: true, committed: true, result: { type: 'complete', jobId: job.id, chunkId: job.chunks[0].id, attempt: 1, artifactIntegrity: 'sha256-AAAA' } }) });
  const parsed = parseRenderWorkerWireResponse(output.body);
  assert.equal(parsed.action, 'complete');
  assert.equal(parsed.artifactIntegrity, 'sha256-AAAA');
  assert.equal(parsed.index, 0);
});

test('response parser rejects uncorrelated or structurally invalid success responses', () => {
  const base = { schema: RENDER_WORKER_WIRE_SCHEMA, type: 'worker.result', requestId: 'req', action: 'claim', verified: true, committed: true, jobId: 'job', chunkId: 'chunk', index: 0, attempt: 1, artifactIntegrity: null };
  assert.throws(() => parseRenderWorkerWireResponse(JSON.stringify({ ...base, requestId: null })), /invalid/);
  assert.throws(() => parseRenderWorkerWireResponse(JSON.stringify({ ...base, artifactIntegrity: 'sha256-AAAA' })), /must not contain/);
  assert.throws(() => parseRenderWorkerWireResponse(JSON.stringify({ ...base, hidden: true })), /Unsupported/);
});
