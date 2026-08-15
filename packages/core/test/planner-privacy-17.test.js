import assert from 'node:assert/strict';
import test from 'node:test';
import { createGraph } from '../src/graph.js';
import { applyOperations } from '../src/operations.js';
import { createCreativeObjectOperations, linkCreativeObjectOperations } from '../src/creative-object.js';
import { createPlannerSnapshot } from '../src/providers.js';

test('planner snapshot honors full metadata and none creative-object model access', () => {
  let graph = createGraph('Film');
  const fullOps = createCreativeObjectOperations(graph, { name: 'Full', objectType: 'person', semantics: { role: 'lead' }, provenance: { source: 'brief' }, permissions: { modelAccess: 'full' } });
  graph = applyOperations(graph, fullOps);
  const metadataOps = createCreativeObjectOperations(graph, { name: 'Metadata', objectType: 'product', semantics: { secret: 'formula' }, provenance: { source: 'private' }, generationHistory: [{ type: 'generated' }], attributes: { sku: 'x' }, permissions: { modelAccess: 'metadata' } });
  graph = applyOperations(graph, metadataOps);
  const hiddenOps = createCreativeObjectOperations(graph, { name: 'Hidden', objectType: 'person', semantics: { identity: 'private' }, permissions: { modelAccess: 'none' } });
  graph = applyOperations(graph, hiddenOps);
  graph = applyOperations(graph, linkCreativeObjectOperations(graph, hiddenOps[0].node.id, graph.projectId, { role: 'appears-in' }));

  const snapshot = createPlannerSnapshot(graph);
  assert.equal(snapshot.nodes[fullOps[0].node.id].props.semantics.role, 'lead');
  assert.equal(snapshot.nodes[metadataOps[0].node.id].props.semantics, undefined);
  assert.equal(snapshot.nodes[metadataOps[0].node.id].props.provenance, undefined);
  assert.equal(snapshot.nodes[metadataOps[0].node.id].props.generationHistory, undefined);
  assert.deepEqual(snapshot.nodes[metadataOps[0].node.id].props.permissions, { modelAccess: 'metadata' });
  assert.equal(snapshot.nodes[hiddenOps[0].node.id], undefined);
  assert.equal(Object.values(snapshot.edges).some((edge) => edge.from === hiddenOps[0].node.id || edge.to === hiddenOps[0].node.id), false);
});

test('creative object model access rejects unknown policy values', () => {
  const graph = createGraph('Film');
  assert.throws(() => createCreativeObjectOperations(graph, { objectType: 'person', permissions: { modelAccess: 'sometimes' } }), /Unsupported creative object modelAccess/);
});

test('planner snapshot fails closed for malformed creative-object access metadata', () => {
  const graph = createGraph('Film');
  graph.nodes.bad = { id: 'bad', kind: 'object', name: 'Do not leak', createdAt: 'x', updatedAt: 'x', props: { permissions: { modelAccess: 'mystery' }, semantics: { secret: 'value' } } };
  const snapshot = createPlannerSnapshot(graph);
  assert.equal(snapshot.nodes.bad, undefined);
});
