import assert from 'node:assert/strict';
import test from 'node:test';
import { createGraph, createNode } from '../src/graph.js';
import { applyOperations } from '../src/operations.js';
import { createCreativeObjectOperations, linkCreativeObjectOperations } from '../src/creative-object.js';
import { createPlannerSemanticContext, createPlannerSnapshot } from '../src/providers.js';

test('focused planner snapshots include requested nodes and bounded neighbors without expanding the project root', () => {
  let graph = createGraph('Film');
  const mayaOps = createCreativeObjectOperations(graph, { name: 'Maya', objectType: 'person' });
  graph = applyOperations(graph, mayaOps);
  const otherOps = createCreativeObjectOperations(graph, { name: 'Other', objectType: 'person' });
  graph = applyOperations(graph, otherOps);
  const shot = createNode({ id: 'shot_reveal', kind: 'layer', name: 'Desert reveal', props: { role: 'marker', time: 3 } });
  graph = applyOperations(graph, [{ type: 'node.add', node: shot }, { type: 'edge.add', edge: { id: 'contains_reveal', from: graph.projectId, to: shot.id, type: 'contains', props: {} } }]);
  graph = applyOperations(graph, linkCreativeObjectOperations(graph, mayaOps[0].node.id, shot.id, { role: 'appears-in' }));
  const snapshot = createPlannerSnapshot(graph, { focusNodeIds: [mayaOps[0].node.id], neighborDepth: 1 });
  assert.ok(snapshot.nodes[graph.projectId]);
  assert.ok(snapshot.nodes[mayaOps[0].node.id]);
  assert.ok(snapshot.nodes[shot.id]);
  assert.equal(snapshot.nodes[otherOps[0].node.id], undefined);
});

test('focused planner snapshots never override creative-object model privacy', () => {
  let graph = createGraph('Film');
  const privateOps = createCreativeObjectOperations(graph, { name: 'Private actor', objectType: 'person', permissions: { modelAccess: 'none' } });
  graph = applyOperations(graph, privateOps);
  const snapshot = createPlannerSnapshot(graph, { focusNodeIds: [privateOps[0].node.id], neighborDepth: 2 });
  assert.equal(snapshot.nodes[privateOps[0].node.id], undefined);
  assert.deepEqual(Object.keys(snapshot.nodes), [graph.projectId]);
});

test('semantic planner context retrieves relevant safe objects and relationship neighbors', () => {
  let graph = createGraph('Film');
  const mayaOps = createCreativeObjectOperations(graph, { name: 'Maya', objectType: 'person', tags: ['hero'] });
  graph = applyOperations(graph, mayaOps);
  const shot = createNode({ id: 'shot_1', kind: 'layer', name: 'Desert reveal', props: { role: 'marker', time: 3 } });
  graph = applyOperations(graph, [{ type: 'node.add', node: shot }, { type: 'edge.add', edge: { id: 'contains_shot', from: graph.projectId, to: shot.id, type: 'contains', props: {} } }]);
  graph = applyOperations(graph, linkCreativeObjectOperations(graph, mayaOps[0].node.id, shot.id, { role: 'appears-in' }));
  const context = createPlannerSemanticContext(graph, 'Maya', { limit: 4, neighborDepth: 1 });
  assert.equal(context.matches[0].id, mayaOps[0].node.id);
  assert.ok(context.graph.nodes[mayaOps[0].node.id]);
  assert.ok(context.graph.nodes[shot.id]);
});

test('semantic planner context searches redacted metadata rather than private semantic fields', () => {
  let graph = createGraph('Film');
  const metadataOps = createCreativeObjectOperations(graph, { name: 'Product', objectType: 'product', semantics: { codename: 'blackbird' }, permissions: { modelAccess: 'metadata' } });
  graph = applyOperations(graph, metadataOps);
  const noneOps = createCreativeObjectOperations(graph, { name: 'Hidden', objectType: 'person', tags: ['nightingale'], permissions: { modelAccess: 'none' } });
  graph = applyOperations(graph, noneOps);
  assert.deepEqual(createPlannerSemanticContext(graph, 'blackbird').matches, []);
  assert.deepEqual(createPlannerSemanticContext(graph, 'nightingale').matches, []);
  assert.equal(createPlannerSemanticContext(graph, 'Product').matches[0].id, metadataOps[0].node.id);
});

test('focused context respects a hard node ceiling', () => {
  let graph = createGraph('Film');
  let centralId;
  for (let index = 0; index < 20; index += 1) {
    const ops = createCreativeObjectOperations(graph, { name: `Object ${index}`, objectType: 'thing' });
    graph = applyOperations(graph, ops);
    if (index === 0) centralId = ops[0].node.id;
    else graph = applyOperations(graph, linkCreativeObjectOperations(graph, centralId, ops[0].node.id, { role: 'related' }));
  }
  const snapshot = createPlannerSnapshot(graph, { focusNodeIds: [centralId], neighborDepth: 1, maxNodes: 5 });
  assert.equal(Object.keys(snapshot.nodes).length, 5);
});
