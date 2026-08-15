import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createGraph} from '../src/graph.js';
import {createOperationLog} from '../src/operation-log.js';
import {createTransaction} from '../src/operations.js';
import {createOperationBatch,signOperationBatch} from '../src/operation-batch.js';
import {COLLABORATION_WIRE_SCHEMA} from '../src/collaboration-wire.js';
import {CollaborationWebSocketClientError,CollaborationWebSocketClientSession} from '../src/collaboration-websocket-client.js';

async function batch(nonce) {
  const graph = createGraph('WS client'), log = createOperationLog({ projectId: graph.projectId });
  const tx = createTransaction('Rename', [{ type: 'node.update', nodeId: graph.projectId, patch: { name: nonce } }]);
  return signOperationBatch(createOperationBatch(log, [tx], { actorId: 'alice', keyId: 'k1', issuedAt: 1000, nonce }), { sign: async ({ bytes }) => createHmac('sha256', 'ws-client').update(bytes).digest('hex') });
}
function result(requestId, signed) {
  return new TextEncoder().encode(JSON.stringify({ schema: COLLABORATION_WIRE_SCHEMA, type: 'batch.result', requestId, status: 'applied', verified: true, committed: true, requiresResign: false, safe: true, head: { sequence: 1, checksum: signed.entries[0].checksum, transactionId: signed.entries[0].transaction.id }, localEntries: 0, remoteEntries: 1, conflicts: [], conflictsTruncated: 0 }));
}

test('WebSocket client sends one bounded request and resolves its correlated response', async () => {
  const signed = await batch('one'), sent = [];
  const client = new CollaborationWebSocketClientSession({ send: async (bytes) => sent.push(bytes) });
  const pending = client.submit(signed, { requestId: 'req-1' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent.length, 1);
  await client.handleMessage(result('req-1', signed));
  const response = await pending;
  assert.equal(response.status, 'applied');
  assert.deepEqual(client.snapshot().pending, []);
});

test('WebSocket client resolves out-of-order responses by request ID', async () => {
  const one = await batch('one'), two = await batch('two');
  const client = new CollaborationWebSocketClientSession({ send: async () => {} });
  const first = client.submit(one, { requestId: 'one' }), second = client.submit(two, { requestId: 'two' });
  await client.handleMessage(result('two', two));
  await client.handleMessage(result('one', one));
  assert.equal((await second).requestId, 'two');
  assert.equal((await first).requestId, 'one');
});

test('WebSocket client enforces pending backpressure and duplicate request IDs', async () => {
  const signed = await batch('limit'), client = new CollaborationWebSocketClientSession({ maxPending: 1, send: async () => {} });
  const first = client.submit(signed, { requestId: 'same' });
  await assert.rejects(() => client.submit(signed, { requestId: 'other' }), (error) => error.code === 'backpressure');
  client.close();
  await assert.rejects(() => first, (error) => error.code === 'connection-closed');
  const duplicateClient = new CollaborationWebSocketClientSession({ maxPending: 2, send: async () => {} });
  const pending = duplicateClient.submit(signed, { requestId: 'same' });
  await assert.rejects(() => duplicateClient.submit(signed, { requestId: 'same' }), (error) => error.code === 'duplicate-request');
  duplicateClient.close();
  await assert.rejects(() => pending, (error) => error.code === 'connection-closed');
});

test('WebSocket client reports send failure once and never retries', async () => {
  const signed = await batch('send'), calls = [];
  const client = new CollaborationWebSocketClientSession({ send: async (bytes) => { calls.push(bytes); throw new Error('socket uncertain'); } });
  await assert.rejects(() => client.submit(signed, { requestId: 'send' }), (error) => error instanceof CollaborationWebSocketClientError && error.code === 'send-unknown-delivery');
  assert.equal(calls.length, 1);
  assert.deepEqual(client.snapshot().pending, []);
});

test('WebSocket client rejects unsolicited or duplicate responses without affecting other pending requests', async () => {
  const signed = await batch('pending'), protocol = [];
  const client = new CollaborationWebSocketClientSession({ send: async () => {}, onProtocolError: async (error) => protocol.push(error.code) });
  const pending = client.submit(signed, { requestId: 'pending' });
  await assert.rejects(() => client.handleMessage(result('unknown', signed)), (error) => error.code === 'unsolicited-response');
  assert.deepEqual(client.snapshot().pending, ['pending']);
  await client.handleMessage(result('pending', signed));
  await pending;
  await assert.rejects(() => client.handleMessage(result('pending', signed)), (error) => error.code === 'unsolicited-response');
  assert.deepEqual(protocol, ['unsolicited-response', 'unsolicited-response']);
});

test('WebSocket client surfaces uncorrelated server errors separately from pending requests', async () => {
  const signed = await batch('uncorrelated'), errors = [];
  const client = new CollaborationWebSocketClientSession({ send: async () => {}, onUncorrelatedError: async (error) => errors.push(error.code) });
  const pending = client.submit(signed, { requestId: 'pending' });
  const payload = new TextEncoder().encode(JSON.stringify({ schema: COLLABORATION_WIRE_SCHEMA, type: 'error', requestId: null, code: 'internal-error', message: 'Collaboration service error' }));
  const handled = await client.handleMessage(payload);
  assert.equal(handled.type, 'uncorrelated');
  assert.deepEqual(errors, ['internal-error']);
  assert.deepEqual(client.snapshot().pending, ['pending']);
  client.close();
  await assert.rejects(() => pending, (error) => error.code === 'connection-closed');
});

test('WebSocket client close rejects all pending requests and blocks new submissions', async () => {
  const one = await batch('close-one'), two = await batch('close-two'), client = new CollaborationWebSocketClientSession({ send: async () => {} });
  const first = client.submit(one, { requestId: 'one' }), second = client.submit(two, { requestId: 'two' });
  client.close('server disconnected');
  await assert.rejects(() => first, (error) => error.code === 'connection-closed' && /server disconnected/.test(error.message));
  await assert.rejects(() => second, (error) => error.code === 'connection-closed');
  await assert.rejects(() => client.submit(one, { requestId: 'new' }), (error) => error.code === 'closed');
});
