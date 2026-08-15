import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRenderWorkerWireRequest,
  encodeRenderWorkerWireRequest,
  parseRenderWorkerWireResponse,
} from '../src/render-worker-wire.js';
import { RenderWorkerWebSocketError, RenderWorkerWebSocketSession } from '../src/render-worker-websocket.js';

function signedClaim(nonce = 'n') {
  return {
    schema: 'media.render-worker.v1', type: 'claim', jobId: 'render:job', jobSignature: 'job-sig',
    actor: { id: 'worker', keyId: 'k1' }, issuedAt: 1000, nonce,
    chunk: { id: 'job-sig:00000', index: 0, expectedAttempt: 1 }, signature: `sig-${nonce}`,
  };
}
function payload(requestId, nonce = requestId) {
  const message = signedClaim(nonce);
  return { message, bytes: encodeRenderWorkerWireRequest(createRenderWorkerWireRequest(message, { requestId })) };
}
function accepted(message) {
  return { verified: true, committed: true, result: { type: 'claim', jobId: message.jobId, chunkId: message.chunk.id, index: message.chunk.index, attempt: message.chunk.expectedAttempt } };
}

test('render worker WebSocket serializes accepted messages per connection', async () => {
  const first = payload('one'), second = payload('two'), events = [], sent = [];
  let release; const gate = new Promise((resolve) => { release = resolve; });
  const session = new RenderWorkerWebSocketSession({
    send: async (bytes) => sent.push(parseRenderWorkerWireResponse(bytes)),
    submit: async (message) => { events.push(`start:${message.nonce}`); if (message.nonce === 'one') await gate; events.push(`end:${message.nonce}`); return accepted(message); },
  });
  const a = session.handleMessage(first.bytes), b = session.handleMessage(second.bytes);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['start:one']);
  release();
  await Promise.all([a, b]);
  assert.deepEqual(events, ['start:one', 'end:one', 'start:two', 'end:two']);
  assert.deepEqual(sent.map((item) => item.requestId), ['one', 'two']);
});

test('render worker WebSocket bounds queued work and correlates backpressure', async () => {
  const first = payload('busy-1'), second = payload('busy-2'), sent = [];
  let release; const gate = new Promise((resolve) => { release = resolve; });
  const session = new RenderWorkerWebSocketSession({ maxPending: 1, send: async (bytes) => sent.push(parseRenderWorkerWireResponse(bytes)), submit: async (message) => { await gate; return accepted(message); } });
  const running = session.handleMessage(first.bytes);
  await new Promise((resolve) => setImmediate(resolve));
  const overflow = await session.handleMessage(second.bytes);
  assert.equal(overflow.statusCode, 429);
  assert.equal(overflow.response.requestId, 'busy-2');
  assert.equal(overflow.response.code, 'backpressure');
  release();
  await running;
  assert.equal(sent.length, 2);
});

test('render worker WebSocket reuses bounded wire errors for malformed messages', async () => {
  const sent = [], session = new RenderWorkerWebSocketSession({ send: async (bytes) => sent.push(parseRenderWorkerWireResponse(bytes)), submit: async () => { throw new Error('must not submit'); } });
  const result = await session.handleMessage('{bad');
  assert.equal(result.statusCode, 400);
  assert.equal(sent[0].type, 'error');
});

test('render worker WebSocket converts unknown service failures to generic errors', async () => {
  const item = payload('failure'), sent = [];
  const session = new RenderWorkerWebSocketSession({ send: async (bytes) => sent.push(parseRenderWorkerWireResponse(bytes)), submit: async () => { throw new Error('database password=secret'); } });
  const result = await session.handleMessage(item.bytes);
  assert.equal(result.statusCode, 500);
  assert.equal(sent[0].code, 'internal-error');
  assert.equal(JSON.stringify(sent[0]).includes('secret'), false);
});

test('render worker WebSocket never retries a failed response send', async () => {
  const item = payload('send-failure'); let sends = 0;
  const session = new RenderWorkerWebSocketSession({ send: async () => { sends++; throw new Error('socket closed'); }, submit: async (message) => accepted(message) });
  await assert.rejects(() => session.handleMessage(item.bytes), (error) => error instanceof RenderWorkerWebSocketError && error.code === 'send-failure');
  assert.equal(sends, 1);
});

test('closed render worker WebSocket sessions reject new messages without submission', async () => {
  const item = payload('closed'); let submits = 0;
  const session = new RenderWorkerWebSocketSession({ send: async () => {}, submit: async () => { submits++; } });
  session.close();
  await assert.rejects(() => session.handleMessage(item.bytes), (error) => error.code === 'closed');
  assert.equal(submits, 0);
});
