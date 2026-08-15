import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createGraph } from '../src/graph.js';
import { createTransaction } from '../src/operations.js';
import { appendOperationLog, createOperationLog, operationLogHead } from '../src/operation-log.js';
import { buildSignedCollaborationResolutionBatch, CollaborationResolutionBatchError } from '../src/collaboration-resolution-batch.js';
import { COLLABORATION_RESOLUTION_INTENT_SCHEMA } from '../src/collaboration-resolution-decisions.js';

function fixture({ choice = 'reapply-remote' } = {}) {
  const graph = createGraph('Resolution');
  const local = createTransaction('Local edit', [{ type: 'node.update', nodeId: graph.projectId, patch: { props: { local: true } } }]);
  const log = appendOperationLog(createOperationLog({ projectId: graph.projectId }), local);
  const intent = { schema: COLLABORATION_RESOLUTION_INTENT_SCHEMA, status: 'final', requestId: 'req-1', head: operationLogHead(log), actor: { id: 'remote', keyId: 'remote-k1' }, modelFingerprint: 'model-fingerprint', decisions: [{ groupId: '2:0', remote: { sequence: 2, transactionId: 'remote-tx', operationIndex: 0 }, choice, rowIds: ['1:0|2:0'] }] };
  return { graph, log, intent, local };
}
function signer(calls = []) { return async ({ bytes }) => { calls.push(bytes); return createHmac('sha256', 'resolution').update(bytes).digest('hex'); }; }
function replacement(graph, id = 'fresh-1') { return { id, label: 'Fresh resolution edit', operations: [{ type: 'node.update', nodeId: graph.projectId, patch: { props: { resolved: true } } }], metadata: { source: 'editor' } }; }

test('builds a fresh signed batch against the refreshed head with signed resolution provenance', async () => {
  const { graph, log, intent } = fixture();
  const fresh = replacement(graph), original = structuredClone(fresh), calls = [];
  const result = await buildSignedCollaborationResolutionBatch({ intent, graph, log, replacements: { '2:0': [fresh] }, actorId: 'local-user', keyId: 'local-k1', issuedAt: 2000, nonce: 'nonce-2', sign: signer(calls) });
  assert.equal(result.status, 'signed');
  assert.deepEqual(result.batch.previousHead, operationLogHead(log));
  assert.equal(result.batch.actor.id, 'local-user');
  assert.equal(result.batch.nonce, 'nonce-2');
  assert.equal(calls.length, 1);
  assert.equal(result.batch.entries[0].transaction.id, 'fresh-1');
  const provenance = result.batch.entries[0].transaction.metadata.collaborationResolution;
  assert.equal(provenance.modelFingerprint, intent.modelFingerprint);
  assert.equal(provenance.groupId, '2:0');
  assert.equal(provenance.choice, 'reapply-remote');
  assert.deepEqual(provenance.remote, intent.decisions[0].remote);
  assert.deepEqual(fresh, original);
  assert.equal(graph.nodes[graph.projectId].props.resolved, undefined);
  assert.equal(result.nextGraph.nodes[graph.projectId].props.resolved, true);
});

test('all keep-local decisions produce an unsigned no-op and do not require signer credentials', async () => {
  const { graph, log, intent } = fixture({ choice: 'keep-local' });
  const result = await buildSignedCollaborationResolutionBatch({ intent, graph, log, replacements: {} });
  assert.equal(result.status, 'no-op');
  assert.equal(result.batch, null);
  assert.deepEqual(result.nextGraph, graph);
  assert.deepEqual(result.resolution.decisions[0], { groupId: '2:0', choice: 'keep-local', transactionIds: [] });
});

test('rejects stale resolution intent heads before reading replacement edits', async () => {
  const { graph, log, intent } = fixture();
  intent.head = { ...intent.head, checksum: 'stale' };
  await assert.rejects(() => buildSignedCollaborationResolutionBatch({ intent, graph, log, replacements: { '2:0': [replacement(graph)] } }), (error) => error instanceof CollaborationResolutionBatchError && error.code === 'ERR_COLLABORATION_RESOLUTION_BATCH_HEAD');
});

test('requires fresh replacements for reapply/manual and forbids replacements for keep-local or unknown groups', async () => {
  const a = fixture();
  await assert.rejects(() => buildSignedCollaborationResolutionBatch({ intent: a.intent, graph: a.graph, log: a.log, replacements: {} }), (error) => error.code === 'ERR_COLLABORATION_RESOLUTION_BATCH_MISSING_REPLACEMENT');
  const b = fixture({ choice: 'manual' });
  await assert.rejects(() => buildSignedCollaborationResolutionBatch({ intent: b.intent, graph: b.graph, log: b.log, replacements: {} }), (error) => error.code === 'ERR_COLLABORATION_RESOLUTION_BATCH_MISSING_REPLACEMENT');
  const c = fixture({ choice: 'keep-local' });
  await assert.rejects(() => buildSignedCollaborationResolutionBatch({ intent: c.intent, graph: c.graph, log: c.log, replacements: { '2:0': [replacement(c.graph)] } }), (error) => error.code === 'ERR_COLLABORATION_RESOLUTION_BATCH_CHOICE');
  const d = fixture();
  await assert.rejects(() => buildSignedCollaborationResolutionBatch({ intent: d.intent, graph: d.graph, log: d.log, replacements: { '2:0': [replacement(d.graph)], extra: [] } }), (error) => error.code === 'ERR_COLLABORATION_RESOLUTION_BATCH_GROUP');
});

test('rejects reused transaction IDs and caller-supplied resolution provenance', async () => {
  const { graph, log, intent, local } = fixture();
  await assert.rejects(() => buildSignedCollaborationResolutionBatch({ intent, graph, log, replacements: { '2:0': [replacement(graph, local.id)] } }), (error) => error.code === 'ERR_COLLABORATION_RESOLUTION_BATCH_REUSED_TRANSACTION');
  const tagged = replacement(graph, 'fresh-tagged'); tagged.metadata.collaborationResolution = { forged: true };
  await assert.rejects(() => buildSignedCollaborationResolutionBatch({ intent, graph, log, replacements: { '2:0': [tagged] } }), (error) => error.code === 'ERR_COLLABORATION_RESOLUTION_BATCH_PROVENANCE');
});

test('rejects duplicate fresh IDs across resolution groups', async () => {
  const { graph, log, intent } = fixture();
  intent.decisions.push({ groupId: '3:0', remote: { sequence: 3, transactionId: 'remote-2', operationIndex: 0 }, choice: 'manual', rowIds: ['1:0|3:0'] });
  const one = replacement(graph, 'same'), two = replacement(graph, 'same');
  await assert.rejects(() => buildSignedCollaborationResolutionBatch({ intent, graph, log, replacements: { '2:0': [one], '3:0': [two] } }), (error) => error.code === 'ERR_COLLABORATION_RESOLUTION_BATCH_REUSED_TRANSACTION');
});

test('invalid graph transitions fail before signing', async () => {
  const { graph, log, intent } = fixture(), calls = [];
  const bad = { id: 'bad', label: 'Bad', operations: [{ type: 'node.remove', nodeId: graph.projectId }], metadata: {} };
  await assert.rejects(() => buildSignedCollaborationResolutionBatch({ intent, graph, log, replacements: { '2:0': [bad] }, actorId: 'local', keyId: 'k', issuedAt: 2, nonce: 'n', sign: signer(calls) }), (error) => error.code === 'ERR_COLLABORATION_RESOLUTION_BATCH_APPLY');
  assert.equal(calls.length, 0);
});

test('non-noop batches require fresh actor/key/time/nonce/signing inputs', async () => {
  const { graph, log, intent } = fixture(), replacements = { '2:0': [replacement(graph)] };
  await assert.rejects(() => buildSignedCollaborationResolutionBatch({ intent, graph, log, replacements }), /actorId/);
  await assert.rejects(() => buildSignedCollaborationResolutionBatch({ intent, graph, log, replacements, actorId: 'a', keyId: 'k', issuedAt: 1, nonce: '' }), /nonce/);
  await assert.rejects(() => buildSignedCollaborationResolutionBatch({ intent, graph, log, replacements, actorId: 'a', keyId: 'k', issuedAt: -1, nonce: 'n' }), /issuedAt/);
  await assert.rejects(() => buildSignedCollaborationResolutionBatch({ intent, graph, log, replacements, actorId: 'a', keyId: 'k', issuedAt: 1, nonce: 'n' }), /signer/);
});

test('returned resolution summary is payload-free while signed transaction carries only fresh editor operations', async () => {
  const { graph, log, intent } = fixture();
  const result = await buildSignedCollaborationResolutionBatch({ intent, graph, log, replacements: { '2:0': [replacement(graph)] }, actorId: 'local', keyId: 'k', issuedAt: 10, nonce: 'n', sign: signer() });
  const summary = JSON.stringify(result.resolution);
  assert.equal(summary.includes('patch'), false);
  assert.equal(summary.includes('resolved'), false);
  assert.equal(result.batch.entries[0].transaction.operations[0].patch.props.resolved, true);
});
