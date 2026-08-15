import test from 'node:test';
import assert from 'node:assert/strict';
import { RENDER_WORKER_WIRE_SCHEMA } from '../src/render-worker-wire.js';
import { RenderWorkerWebSocketClientError, RenderWorkerWebSocketClientSession } from '../src/render-worker-websocket-client.js';

function signedClaim(nonce = 'n') {
  return {
    schema: 'media.render-worker.v1', type: 'claim', jobId: 'render:job', jobSignature: 'job-sig',
    actor: { id: 'worker', keyId: 'k1' }, issuedAt: 1000, nonce,
    chunk: { id: 'job-sig:00000', index: 0, expectedAttempt: 1 }, signature: `sig-${nonce}`,
  };
}
function result(requestId, message = signedClaim()) {
  return new TextEncoder().encode(JSON.stringify({ schema: RENDER_WORKER_WIRE_SCHEMA, type: 'worker.result', requestId, action: 'claim', verified: true, committed: true, jobId: message.jobId, chunkId: message.chunk.id, index: message.chunk.index, attempt: message.chunk.expectedAttempt, artifactIntegrity: null }));
}

test('render worker WebSocket client sends one bounded request and resolves its correlated response', async () => {
  const message = signedClaim('one'), sent = [];
  const client = new RenderWorkerWebSocketClientSession({ send: async (bytes) => sent.push(bytes) });
  const pending = client.submit(message, { requestId: 'req-1' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent.length, 1);
  await client.handleMessage(result('req-1', message));
  const response = await pending;
  assert.equal(response.action, 'claim');
  assert.deepEqual(client.snapshot().pending, []);
});

test('render worker WebSocket client resolves out-of-order responses by request ID', async () => {
  const one = signedClaim('one'), two = signedClaim('two');
  const client = new RenderWorkerWebSocketClientSession({ send: async () => {} });
  const first = client.submit(one, { requestId: 'one' }), second = client.submit(two, { requestId: 'two' });
  await client.handleMessage(result('two', two));
  await client.handleMessage(result('one', one));
  assert.equal((await second).requestId, 'two');
  assert.equal((await first).requestId, 'one');
});

test('render worker WebSocket client enforces pending backpressure and duplicate request IDs', async () => {
  const message = signedClaim('limit'), client = new RenderWorkerWebSocketClientSession({ maxPending: 1, send: async () => {} });
  const first = client.submit(message, { requestId: 'same' });
  await assert.rejects(() => client.submit(message, { requestId: 'other' }), (error) => error.code === 'backpressure');
  client.close();
  await assert.rejects(() => first, (error) => error.code === 'connection-closed');
  const duplicateClient = new RenderWorkerWebSocketClientSession({ maxPending: 2, send: async () => {} });
  const pending = duplicateClient.submit(message, { requestId: 'same' });
  await assert.rejects(() => duplicateClient.submit(message, { requestId: 'same' }), (error) => error.code === 'duplicate-request');
  duplicateClient.close();
  await assert.rejects(() => pending, (error) => error.code === 'connection-closed');
});

test('render worker WebSocket client reports send failure once and never retries', async () => {
  const message = signedClaim('send'), calls = [];
  const client = new RenderWorkerWebSocketClientSession({ send: async (bytes) => { calls.push(bytes); throw new Error('socket uncertain'); } });
  await assert.rejects(() => client.submit(message, { requestId: 'send' }), (error) => error instanceof RenderWorkerWebSocketClientError && error.code === 'send-unknown-delivery');
  assert.equal(calls.length, 1);
  assert.deepEqual(client.snapshot().pending, []);
});

test('render worker WebSocket client rejects unsolicited or duplicate responses without affecting other pending requests', async () => {
  const message = signedClaim('pending'), protocol = [];
  const client = new RenderWorkerWebSocketClientSession({ send: async () => {}, onProtocolError: async (error) => protocol.push(error.code) });
  const pending = client.submit(message, { requestId: 'pending' });
  await assert.rejects(() => client.handleMessage(result('unknown', message)), (error) => error.code === 'unsolicited-response');
  assert.deepEqual(client.snapshot().pending, ['pending']);
  await client.handleMessage(result('pending', message));
  await pending;
  await assert.rejects(() => client.handleMessage(result('pending', message)), (error) => error.code === 'unsolicited-response');
  assert.deepEqual(protocol, ['unsolicited-response', 'unsolicited-response']);
});

test('render worker WebSocket client surfaces uncorrelated server errors separately from pending requests', async () => {
  const message = signedClaim('uncorrelated'), errors = [];
  const client = new RenderWorkerWebSocketClientSession({ send: async () => {}, onUncorrelatedError: async (error) => errors.push(error.code) });
  const pending = client.submit(message, { requestId: 'pending' });
  const payload = new TextEncoder().encode(JSON.stringify({ schema: RENDER_WORKER_WIRE_SCHEMA, type: 'error', requestId: null, code: 'internal-error', message: 'Render worker service error' }));
  const handled = await client.handleMessage(payload);
  assert.equal(handled.type, 'uncorrelated');
  assert.deepEqual(errors, ['internal-error']);
  assert.deepEqual(client.snapshot().pending, ['pending']);
  client.close();
  await assert.rejects(() => pending, (error) => error.code === 'connection-closed');
});

test('render worker WebSocket client close rejects all pending requests and blocks new submissions', async () => {
  const one = signedClaim('close-one'), two = signedClaim('close-two'), client = new RenderWorkerWebSocketClientSession({ send: async () => {} });
  const first = client.submit(one, { requestId: 'one' }), second = client.submit(two, { requestId: 'two' });
  client.close('server disconnected');
  await assert.rejects(() => first, (error) => error.code === 'connection-closed' && /server disconnected/.test(error.message));
  await assert.rejects(() => second, (error) => error.code === 'connection-closed');
  await assert.rejects(() => client.submit(one, { requestId: 'new' }), (error) => error.code === 'closed');
});
