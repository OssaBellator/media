import assert from 'node:assert/strict';
import test from 'node:test';
import { createGraph, createNode } from '../src/graph.js';
import { applyOperations } from '../src/operations.js';
import { createCreativeObjectOperations, linkCreativeObjectOperations } from '../src/creative-object.js';
import { createSemanticIndex, searchSemanticGraph, searchSemanticIndex } from '../src/semantic-search.js';

test('semantic search ranks names object types tags and semantic attributes deterministically', () => {
  let graph = createGraph('Launch campaign');
  const mayaOps = createCreativeObjectOperations(graph, { name: 'Maya', objectType: 'person', tags: ['hero', 'cast'], semantics: { wardrobe: 'blue jacket', role: 'lead performer' } });
  graph = applyOperations(graph, mayaOps);
  const jacketOps = createCreativeObjectOperations(graph, { parentId: mayaOps[0].node.id, name: 'Jacket', objectType: 'wardrobe', tags: ['blue'], attributes: { material: 'denim' } });
  graph = applyOperations(graph, jacketOps);
  assert.equal(searchSemanticGraph(graph, 'Maya')[0].id, mayaOps[0].node.id);
  assert.equal(searchSemanticGraph(graph, 'blue jacket')[0].id, jacketOps[0].node.id);
  assert.equal(searchSemanticGraph(graph, 'lead performer')[0].id, mayaOps[0].node.id);
});

test('semantic search incorporates graph relationship roles and neighbor names', () => {
  let graph = createGraph('Film');
  const mayaOps = createCreativeObjectOperations(graph, { name: 'Maya', objectType: 'person' });
  graph = applyOperations(graph, mayaOps);
  const shot = createNode({ id: 'shot_1', kind: 'layer', name: 'Desert reveal', props: { role: 'marker', time: 3 } });
  graph = applyOperations(graph, [{ type: 'node.add', node: shot }, { type: 'edge.add', edge: { id: 'contains_shot', from: graph.projectId, to: shot.id, type: 'contains', props: {} } }]);
  graph = applyOperations(graph, linkCreativeObjectOperations(graph, mayaOps[0].node.id, shot.id, { role: 'appears-in' }));
  const result = searchSemanticGraph(graph, 'desert reveal', { kinds: ['object'] });
  assert.equal(result[0].id, mayaOps[0].node.id);
  assert.ok(result[0].sources.desert.includes('relationships'));
});

test('semantic index can be reused and queries return bounded stable results', () => {
  let graph = createGraph('Project');
  for (let index = 0; index < 30; index += 1) {
    const ops = createCreativeObjectOperations(graph, { name: `Product ${String(index).padStart(2, '0')}`, objectType: 'product', tags: ['catalog'] });
    graph = applyOperations(graph, ops);
  }
  const index = createSemanticIndex(graph);
  const first = searchSemanticIndex(index, 'catalog', { limit: 5 });
  const second = searchSemanticIndex(index, 'catalog', { limit: 5 });
  assert.equal(first.length, 5);
  assert.deepEqual(first, second);
  assert.deepEqual(first.map((item) => item.name), ['Product 00', 'Product 01', 'Product 02', 'Product 03', 'Product 04']);
});

test('semantic search can restrict node kinds and returns no result for empty intent', () => {
  const graph = createGraph('Campaign');
  assert.deepEqual(searchSemanticGraph(graph, 'Campaign', { kinds: ['object'] }), []);
  assert.deepEqual(searchSemanticGraph(graph, '   '), []);
});

test('semantic indexing bounds deep metadata expansion instead of exploding context', () => {
  let graph = createGraph('Film');
  const ops = createCreativeObjectOperations(graph, { name: 'Dense', objectType: 'thing', semantics: Object.fromEntries(Array.from({ length: 1000 }, (_, index) => [`field${index}`, `value${index}`])) });
  graph = applyOperations(graph, ops);
  const index = createSemanticIndex(graph, { maxTermsPerNode: 32 });
  const document = index.documents.find((item) => item.id === ops[0].node.id);
  assert.ok(Object.keys(document.terms).length <= 32);
});
