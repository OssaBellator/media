import assert from 'node:assert/strict';
import test from 'node:test';
import { createGraph } from '../src/graph.js';
import { applyOperations } from '../src/operations.js';
import {
  CREATIVE_OBJECT_SCHEMA,
  appendCreativeObjectGenerationOperation,
  createCreativeObjectOperations,
  creativeObjectRelationships,
  creativeObjectsForTarget,
  findCreativeObjects,
  linkCreativeObjectOperations,
  updateCreativeObjectOperations,
} from '../src/creative-object.js';

test('creative objects are addressable graph nodes contained by the project', () => {
  let graph = createGraph('Film');
  const operations = createCreativeObjectOperations(graph, { name: 'Maya', objectType: 'person', semanticId: 'person:maya', tags: ['cast', 'hero'] });
  graph = applyOperations(graph, operations);
  const object = operations[0].node;
  assert.equal(object.props.creativeObjectSchema, CREATIVE_OBJECT_SCHEMA);
  assert.equal(graph.nodes[object.id].props.objectType, 'person');
  assert.equal(findCreativeObjects(graph, { tag: 'hero' })[0].id, object.id);
});

test('creative objects can form a contained semantic hierarchy', () => {
  let graph = createGraph('Film');
  const personOps = createCreativeObjectOperations(graph, { name: 'Maya', objectType: 'person' });
  graph = applyOperations(graph, personOps);
  const wardrobeOps = createCreativeObjectOperations(graph, { parentId: personOps[0].node.id, name: 'Blue jacket', objectType: 'wardrobe' });
  graph = applyOperations(graph, wardrobeOps);
  assert.equal(graph.edges[wardrobeOps[1].edge.id].from, personOps[0].node.id);
});

test('creative object relationships attach temporal geometry and tracking to existing graph nodes', () => {
  let graph = createGraph('Film');
  const objectOps = createCreativeObjectOperations(graph, { name: 'Maya', objectType: 'person' });
  graph = applyOperations(graph, objectOps);
  const object = objectOps[0].node;
  const relationOps = linkCreativeObjectOperations(graph, object.id, graph.projectId, { role: 'appears-in', time: { start: 1, end: 4 }, geometry: { x: 0.4, y: 0.5 }, tracking: { method: 'temporal-mask' } });
  graph = applyOperations(graph, relationOps);
  assert.equal(creativeObjectRelationships(graph, object.id, { role: 'appears-in' }).length, 1);
  assert.equal(creativeObjectsForTarget(graph, graph.projectId, { role: 'appears-in' })[0].id, object.id);
});

test('creative object metadata can be enriched without replacing existing semantic fields', () => {
  let graph = createGraph('Film');
  const ops = createCreativeObjectOperations(graph, { name: 'Maya', objectType: 'person', semantics: { actor: 'Maya' }, provenance: { source: 'manual' } });
  graph = applyOperations(graph, ops);
  const object = ops[0].node;
  graph = applyOperations(graph, updateCreativeObjectOperations(graph, object.id, { semantics: { wardrobe: 'jacket:26' }, confidence: 0.92 }));
  assert.deepEqual(graph.nodes[object.id].props.semantics, { actor: 'Maya', wardrobe: 'jacket:26' });
  assert.equal(graph.nodes[object.id].props.confidence, 0.92);
});

test('generation history remains an editable part of the object instead of flattening provenance', () => {
  let graph = createGraph('Film');
  const ops = createCreativeObjectOperations(graph, { name: 'Jacket', objectType: 'wardrobe' });
  graph = applyOperations(graph, ops);
  const object = ops[0].node;
  graph = applyOperations(graph, appendCreativeObjectGenerationOperation(graph, object.id, { type: 'restyle', provider: 'model-a', sourcePlanId: 'plan-1' }));
  const event = graph.nodes[object.id].props.generationHistory[0];
  assert.equal(event.type, 'restyle');
  assert.equal(event.sourcePlanId, 'plan-1');
  assert.ok(event.id);
  assert.ok(event.at);
});

test('creative object validation rejects invalid confidence and relationship roles', () => {
  const graph = createGraph('Film');
  assert.throws(() => createCreativeObjectOperations(graph, { objectType: 'person', confidence: 2 }), /between 0 and 1/);
  const ops = createCreativeObjectOperations(graph, { objectType: 'person' });
  const next = applyOperations(graph, ops);
  assert.throws(() => linkCreativeObjectOperations(next, ops[0].node.id, next.projectId, { role: '' }), /non-empty string/);
});

test('project invariants reject orphan creative objects and untyped semantic relationships', () => {
  const graph = createGraph('Film');
  const ops = createCreativeObjectOperations(graph, { objectType: 'person' });
  assert.throws(() => applyOperations(graph, [ops[0]]), /exactly one project\/object parent/);
  const next = applyOperations(graph, ops);
  const badEdge = { id: 'edge_bad', from: ops[0].node.id, to: next.projectId, type: 'relates-to', props: {} };
  assert.throws(() => applyOperations(next, [{ type: 'edge.add', edge: badEdge }]), /requires a role/);
});
