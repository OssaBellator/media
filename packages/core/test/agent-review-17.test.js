import assert from 'node:assert/strict';
import test from 'node:test';
import { createGraph } from '../src/graph.js';
import { applyOperations } from '../src/operations.js';
import { createAgentPlan, selectAgentPlanOperations } from '../src/agent-plan.js';
import { createAgentPlanReview } from '../src/agent-review.js';
import { createCreativeObjectOperations } from '../src/creative-object.js';

test('agent review exposes bounded human-readable before and after changes', () => {
  const graph = createGraph('Before');
  const longText = 'x'.repeat(220);
  const plan = createAgentPlan(graph, {
    intent: 'rename and annotate',
    summary: 'Update project',
    providerId: 'mock',
    operations: [{ type: 'node.update', nodeId: graph.projectId, patch: { name: longText, props: { values: Array.from({ length: 40 }, (_, index) => index) } } }],
  });
  const review = createAgentPlanReview(graph, plan);
  assert.equal(review.operations.length, 1);
  assert.match(review.operations[0].summary, /Update Before/);
  const nameChange = review.operations[0].changes.find((change) => change.path === 'name');
  assert.equal(nameChange.before, 'Before');
  assert.ok(nameChange.after.endsWith('…'));
  const valuesChange = review.operations[0].changes.find((change) => change.path === 'props.values');
  assert.deepEqual(valuesChange.after, { type: 'array', length: 40 });
});

test('agent plan operation selection creates a revised graph-bound proposal', () => {
  const graph = createGraph('Before');
  const plan = createAgentPlan(graph, {
    intent: 'edit project',
    summary: 'Two independent changes',
    providerId: 'mock',
    operations: [
      { type: 'node.update', nodeId: graph.projectId, patch: { name: 'First' } },
      { type: 'node.update', nodeId: graph.projectId, patch: { props: { note: 'keep me' } } },
    ],
  });
  const selected = selectAgentPlanOperations(graph, plan, [1], { summary: 'Keep note only' });
  assert.equal(selected.revision, 2);
  assert.equal(selected.operations.length, 1);
  assert.equal(selected.operations[0].patch.props.note, 'keep me');
  assert.equal(selected.summary, 'Keep note only');
});

test('operation selection preflights dependencies instead of allowing a broken partial plan', () => {
  const graph = createGraph('Before');
  const objectOps = createCreativeObjectOperations(graph, { name: 'Maya', objectType: 'person' });
  const plan = createAgentPlan(graph, { intent: 'add Maya', providerId: 'mock', operations: objectOps });
  assert.throws(() => selectAgentPlanOperations(graph, plan, [1]), /unknown node/i);
  const valid = selectAgentPlanOperations(graph, plan, [0, 1]);
  const review = createAgentPlanReview(graph, valid);
  assert.equal(review.operations[0].type, 'node.add');
  assert.equal(review.operations[1].type, 'edge.add');
  assert.match(review.operations[1].summary, /creative-object/);
});
