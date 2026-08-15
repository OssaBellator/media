import assert from 'node:assert/strict';
import test from 'node:test';
import { createGraph } from '../src/graph.js';
import { applyOperations, applyTransaction, createTransaction } from '../src/operations.js';
import { applyAgentPlan, createAgentPlan } from '../src/agent-plan.js';
import { AgentPlanRebaseConflictError, analyzeAgentPlanRebase, rebaseAgentPlan } from '../src/agent-rebase.js';

test('agent plan safely rebases across an unrelated project edit', () => {
  const base = createGraph('Before');
  const plan = createAgentPlan(base, { intent: 'rename', providerId: 'mock', operations: [{ type: 'node.update', nodeId: base.projectId, patch: { name: 'Agent name' } }] });
  const local = createTransaction('Add note', [{ type: 'node.update', nodeId: base.projectId, patch: { props: { note: 'manual' } } }]);
  const current = applyTransaction(base, local);
  const analysis = analyzeAgentPlanRebase(base, current, plan, [local]);
  assert.equal(analysis.status, 'rebase-safe');
  const rebased = rebaseAgentPlan(base, current, plan, [local]);
  assert.equal(rebased.id, plan.id);
  assert.equal(rebased.revision, 2);
  const applied = applyAgentPlan(current, rebased);
  assert.equal(applied.nodes[base.projectId].name, 'Agent name');
  assert.equal(applied.nodes[base.projectId].props.note, 'manual');
  assert.deepEqual(rebased.metadata.rebase.transactionIds, [local.id]);
});

test('agent plan rebase refuses overlapping field edits', () => {
  const base = createGraph('Before');
  const plan = createAgentPlan(base, { intent: 'rename', providerId: 'mock', operations: [{ type: 'node.update', nodeId: base.projectId, patch: { name: 'Agent name' } }] });
  const local = createTransaction('Manual rename', [{ type: 'node.update', nodeId: base.projectId, patch: { name: 'Human name' } }]);
  const current = applyTransaction(base, local);
  const analysis = analyzeAgentPlanRebase(base, current, plan, [local]);
  assert.equal(analysis.status, 'conflict');
  assert.equal(analysis.conflicts[0].resources[0].left.path, 'field:name');
  assert.throws(() => rebaseAgentPlan(base, current, plan, [local]), (error) => error instanceof AgentPlanRebaseConflictError && error.code === 'AGENT_PLAN_REBASE_CONFLICT');
});

test('agent plan rebase refuses removal of a node the proposal updates', () => {
  let base = createGraph('Before');
  const node = { id: 'node_target', kind: 'asset', name: 'Target', createdAt: 'x', updatedAt: 'x', props: {} };
  base = applyOperations(base, [{ type: 'node.add', node }]);
  const plan = createAgentPlan(base, { intent: 'rename asset', providerId: 'mock', operations: [{ type: 'node.update', nodeId: node.id, patch: { name: 'Agent asset' } }] });
  const local = createTransaction('Remove target', [{ type: 'node.remove', nodeId: node.id }]);
  const current = applyTransaction(base, local);
  assert.equal(analyzeAgentPlanRebase(base, current, plan, [local]).safe, false);
});

test('agent rebase verifies that supplied transactions exactly reconstruct current state', () => {
  const base = createGraph('Before');
  const plan = createAgentPlan(base, { intent: 'rename', providerId: 'mock', operations: [{ type: 'node.update', nodeId: base.projectId, patch: { name: 'Agent' } }] });
  const actual = applyOperations(base, [{ type: 'node.update', nodeId: base.projectId, patch: { props: { note: 'actual' } } }]);
  const wrong = createTransaction('Wrong', [{ type: 'node.update', nodeId: base.projectId, patch: { props: { note: 'wrong' } } }]);
  assert.throws(() => analyzeAgentPlanRebase(base, actual, plan, [wrong]), /do not reconstruct/);
});
