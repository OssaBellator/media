import assert from 'node:assert/strict';
import test from 'node:test';
import { createGraph, createNode } from '../src/graph.js';
import { applyOperations } from '../src/operations.js';
import { createCreativeObjectOperations, linkCreativeObjectOperations } from '../src/creative-object.js';
import { MAX_SEMANTIC_QUERY_CHARS, createSemanticIndex, searchSemanticGraph, searchSemanticIndex } from '../src/semantic-search.js';

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

test('semantic search rejects coercive queries and accessor-bearing options without executing them', () => {
  const graph = createGraph('Campaign');
  let coercions = 0;
  const query = { toString() { coercions += 1; return 'Campaign'; } };
  assert.throws(() => searchSemanticGraph(graph, query), /Semantic query must be a string/);
  assert.equal(coercions, 0);

  let getterCalls = 0;
  const options = {};
  Object.defineProperty(options, 'limit', { enumerable: true, get() { getterCalls += 1; return 5; } });
  assert.throws(() => searchSemanticGraph(graph, 'Campaign', options), /must contain enumerable data fields only/);
  assert.equal(getterCalls, 0);

  assert.throws(() => searchSemanticGraph(graph, 'Campaign', { limit: '5' }), /Semantic search limit must be an integer/);
  assert.throws(() => searchSemanticGraph(graph, 'Campaign', { minimumScore: '1' }), /minimumScore must be a finite non-negative number/);
  assert.throws(() => createSemanticIndex(graph, { maxTermsPerNode: '32' }), /maxTermsPerNode must be an integer/);
  assert.throws(() => searchSemanticGraph(graph, 'x'.repeat(MAX_SEMANTIC_QUERY_CHARS + 1)), /Semantic query exceeds 4096 characters/);
});

test('semantic kind filters require bounded dense string values without coercion', () => {
  const graph = createGraph('Campaign');
  let coercions = 0;
  const forged = { toString() { coercions += 1; return 'project'; } };
  assert.throws(() => searchSemanticGraph(graph, 'Campaign', { kinds: [forged] }), /Semantic kind must be a non-empty string/);
  assert.equal(coercions, 0);

  let getterCalls = 0;
  const kinds = [];
  Object.defineProperty(kinds, '0', { enumerable: true, get() { getterCalls += 1; return 'project'; } });
  kinds.length = 1;
  assert.throws(() => searchSemanticGraph(graph, 'Campaign', { kinds }), /Semantic kinds must contain enumerable data values only/);
  assert.equal(getterCalls, 0);
});
