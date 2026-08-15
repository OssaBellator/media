import test from 'node:test';
import assert from 'node:assert/strict';
import { CollaborationResolutionSession } from '../collaboration-resolution-session.js';

function model({ complete = true } = {}) {
  const remote = {
    sequence: 3,
    transactionId: 'remote-tx',
    label: 'Remote title',
    operationIndex: 0,
    operation: { type: 'node.update', scope: 'node', id: 'node-1', name: 'Node', fields: ['props:title'], summary: 'Update Node · props:title' },
  };
  return {
    schema: 'media.collaboration-resolution.v1',
    requestId: 'req-session',
    status: 'conflict',
    head: { sequence: 4, checksum: 'head', transactionId: 'local-tx' },
    actor: { id: 'alice', keyId: 'key-1' },
    rows: [{
      id: '4:0|3:0',
      local: { sequence: 4, transactionId: 'local-tx', label: 'Local title', operationIndex: 0, operation: { type: 'node.update', summary: 'Update Node · props:title' } },
      remote,
      resources: [{ local: { label: 'Node · property title' }, remote: { label: 'Node · property title' } }],
    }],
    conflictsTruncated: complete ? 0 : 1,
    complete,
    requiresRefresh: true,
    requiresResign: true,
    allowsAutomaticMerge: false,
  };
}

test('resolution session owns immutable UI draft state and renders it', () => {
  const source = model();
  const session = new CollaborationResolutionSession({ model: source });
  const before = session.snapshot();
  assert.equal(before.draft.groups[0].decision, null);
  const groupId = before.draft.groups[0].id;
  session.choose(groupId, 'keep-local');
  const after = session.snapshot();
  assert.equal(after.draft.groups[0].decision, 'keep-local');
  assert.equal(source.rows[0].remote.label, 'Remote title');
  assert.match(session.render(), /aria-pressed="true"/);
});

test('resolution session finalizes only payload-free intent through callback', async () => {
  const finalized = [];
  const session = new CollaborationResolutionSession({ model: model(), onFinalize: async (intent) => finalized.push(intent) });
  const groupId = session.snapshot().draft.groups[0].id;
  session.choose(groupId, 'reapply-remote');
  const intent = await session.finalize();
  assert.equal(finalized.length, 1);
  assert.deepEqual(finalized[0], intent);
  assert.equal(intent.decisions[0].choice, 'reapply-remote');
  const text = JSON.stringify(intent);
  assert.equal(text.includes('props:title'), false);
  assert.equal(text.includes('signature'), false);
  assert.equal(text.includes('patch'), false);
});

test('resolution session refuses finalize before decisions are complete', async () => {
  const session = new CollaborationResolutionSession({ model: model() });
  await assert.rejects(() => session.finalize(), /explicit decision/);
});

test('resolution session cannot finalize a truncated conflict model', async () => {
  const session = new CollaborationResolutionSession({ model: model({ complete: false }) });
  session.choose(session.snapshot().draft.groups[0].id, 'manual');
  await assert.rejects(() => session.finalize(), /incomplete conflict set/);
});

test('resolution session finalization failure does not mutate decisions', async () => {
  const session = new CollaborationResolutionSession({ model: model(), onFinalize: async () => { throw new Error('consumer rejected'); } });
  const groupId = session.snapshot().draft.groups[0].id;
  session.choose(groupId, 'keep-local');
  await assert.rejects(() => session.finalize(), /consumer rejected/);
  assert.equal(session.snapshot().draft.groups[0].decision, 'keep-local');
});

test('closed resolution session rejects render, choose and finalize', async () => {
  const session = new CollaborationResolutionSession({ model: model() });
  session.close();
  assert.equal(session.snapshot().closed, true);
  assert.throws(() => session.render(), /closed/);
  assert.throws(() => session.choose('x', 'manual'), /closed/);
  await assert.rejects(() => session.finalize(), /closed/);
});
