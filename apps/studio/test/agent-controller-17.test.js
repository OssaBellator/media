import test from 'node:test';
import assert from 'node:assert/strict';
import { StudioAgentController } from '../agent-controller.js';

function fakeProposal() {
  let pending = null;
  return {
    snapshot: () => pending ? { status: 'pending', plan: pending, review: { operations: pending.operations }, error: null } : { status: 'idle', plan: null, review: null, error: null },
    propose: async (intent) => { pending = { intent, operations: [{ index: 0 }, { index: 1 }] }; },
    select: (indexes) => { pending = { ...pending, operations: indexes.map((index) => ({ index })) }; return { status: 'pending' }; },
    discard: () => { const value = pending; pending = null; return value; },
    apply: async () => { const value = pending; pending = null; return { plan: value }; },
  };
}

function fakeDelegation(proposal) {
  let workflow = null;
  return {
    snapshot: () => ({ ...proposal.snapshot(), workflow }),
    execute: async (value) => { workflow = { id: value.id, taskCount: 2, assetWriteCount: 1 }; await proposal.propose(`workflow:${value.id}`); },
    select: (indexes) => proposal.select(indexes),
    discard: () => { const plan = proposal.discard(); const value = workflow; workflow = null; return { plan, workflow: value }; },
    apply: async () => { const result = await proposal.apply(); const value = workflow; workflow = null; return { ...result, workflow: value }; },
  };
}

test('ordinary proposals stay pending until explicit apply', async () => {
  const proposal = fakeProposal();
  const controller = new StudioAgentController({ proposalSession: proposal });
  const state = await controller.propose('make it square');
  assert.equal(state.status, 'pending');
  assert.equal(controller.hasPending(), true);
  await assert.rejects(() => controller.propose('replace it'), /Review or discard/);
  const applied = await controller.apply();
  assert.equal(applied.plan.intent, 'make it square');
  assert.equal(controller.snapshot().status, 'idle');
});

test('selection and revision remain explicit review actions', async () => {
  const proposal = fakeProposal();
  const controller = new StudioAgentController({ proposalSession: proposal });
  await controller.propose('first');
  controller.select([1]);
  assert.deepEqual(controller.snapshot().plan.operations, [{ index: 1 }]);
  await controller.revise('second');
  assert.equal(controller.snapshot().plan.intent, 'second');
});

test('delegated workflows use the same review/apply surface', async () => {
  const proposal = fakeProposal();
  const delegation = fakeDelegation(proposal);
  const controller = new StudioAgentController({ proposalSession: proposal, delegationSession: delegation });
  const state = await controller.delegate({ id: 'wf-1' });
  assert.equal(state.workflow.id, 'wf-1');
  controller.select([0]);
  const applied = await controller.apply();
  assert.equal(applied.workflow.id, 'wf-1');
  assert.equal(controller.snapshot().status, 'idle');
});

test('discard clears delegated workflow and proposal together', async () => {
  const proposal = fakeProposal();
  const delegation = fakeDelegation(proposal);
  const controller = new StudioAgentController({ proposalSession: proposal, delegationSession: delegation });
  await controller.delegate({ id: 'wf-2' });
  const discarded = controller.discard();
  assert.equal(discarded.workflow.id, 'wf-2');
  assert.equal(controller.snapshot().status, 'idle');
});
