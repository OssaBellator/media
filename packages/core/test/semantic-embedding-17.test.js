import assert from 'node:assert/strict';
import test from 'node:test';
import { createGraph } from '../src/graph.js';
import { applyOperations } from '../src/operations.js';
import { createCreativeObjectOperations } from '../src/creative-object.js';
import { ModelRouter } from '../src/model-router.js';
import { createSemanticEmbeddingIndex, embedSemanticQuery, searchSemanticEmbeddingIndex, searchSemanticHybrid } from '../src/semantic-embedding.js';

function embedRouter(seen = []) {
  return new ModelRouter().register({ id: 'embedder', operations: ['embed'], invoke: async (_operation, input) => {
    seen.push(...input.texts);
    return { vectors: input.texts.map((text) => {
      const value = text.toLowerCase();
      return [Number(value.includes('maya')), Number(value.includes('product')), Number(value.includes('blue'))];
    }) };
  } });
}

test('semantic embedding index uses privacy-redacted semantic documents and excludes hidden objects', async () => {
  let graph = createGraph('Film');
  const full = createCreativeObjectOperations(graph, { name: 'Maya', objectType: 'person', semantics: { wardrobe: 'blue' } });
  graph = applyOperations(graph, full);
  const metadata = createCreativeObjectOperations(graph, { name: 'Product', objectType: 'product', semantics: { codename: 'secretword' }, permissions: { modelAccess: 'metadata' } });
  graph = applyOperations(graph, metadata);
  const hidden = createCreativeObjectOperations(graph, { name: 'Hidden person', objectType: 'person', tags: ['nightingale'], permissions: { modelAccess: 'none' } });
  graph = applyOperations(graph, hidden);
  const seen = [];
  const index = await createSemanticEmbeddingIndex(graph, embedRouter(seen), { kinds: ['object'] });
  assert.equal(index.documents.length, 2);
  assert.equal(index.documents.some((item) => item.id === hidden[0].node.id), false);
  assert.equal(seen.some((text) => text.includes('secretword')), false);
  assert.equal(seen.some((text) => text.includes('nightingale')), false);
});

test('embedding search and query routing rank cosine similarity deterministically', async () => {
  let graph = createGraph('Film');
  const maya = createCreativeObjectOperations(graph, { name: 'Maya', objectType: 'person', tags: ['blue'] });
  graph = applyOperations(graph, maya);
  const product = createCreativeObjectOperations(graph, { name: 'Product', objectType: 'product' });
  graph = applyOperations(graph, product);
  const seen = [];
  const router = embedRouter(seen);
  const index = await createSemanticEmbeddingIndex(graph, router, { kinds: ['object'] });
  assert.equal(searchSemanticEmbeddingIndex(index, [1, 0, 1])[0].id, maya[0].node.id);
  const beforeQuery = seen.length;
  let getterCalls = 0;
  const unsafePolicy = {};
  Object.defineProperty(unsafePolicy, 'allowedBackendIds', { enumerable: true, get() { getterCalls += 1; return ['embedder']; } });
  await assert.rejects(() => embedSemanticQuery(router, index, 'Maya blue', { policy: unsafePolicy }), /Model routing policy must be JSON-safe/);
  assert.equal(getterCalls, 0);
  assert.equal(seen.length, beforeQuery);
  await assert.rejects(() => embedSemanticQuery(router, index, 'Maya blue', { policy: { allowedBackendIds: [1] } }), /allowedBackendIds must contain non-empty string ids/);
  assert.equal(seen.length, beforeQuery);
  const queried = await embedSemanticQuery(router, index, 'Maya blue');
  assert.equal(queried[0].id, maya[0].node.id);
  assert.equal(queried[0].backendId, 'embedder');
});

test('embedding index rejects backend dimension drift and scalar-budget explosions', async () => {
  let graph = createGraph('Film');
  for (let i = 0; i < 3; i += 1) graph = applyOperations(graph, createCreativeObjectOperations(graph, { name: `Object ${i}`, objectType: 'thing' }));
  let call = 0;
  const drifting = new ModelRouter().register({ id: 'drift', operations: ['embed'], invoke: async (_operation, input) => ({ vectors: input.texts.map(() => (++call > 1 ? [1, 2] : [1, 2, 3])) }) });
  await assert.rejects(() => createSemanticEmbeddingIndex(graph, drifting, { kinds: ['object'], batchSize: 1 }), /do not match expected/);
  const wide = new ModelRouter().register({ id: 'wide', operations: ['embed'], invoke: async (_operation, input) => ({ vectors: input.texts.map(() => Array(100).fill(1)) }) });
  await assert.rejects(() => createSemanticEmbeddingIndex(graph, wide, { kinds: ['object'], maxScalars: 256 }), /exceeds 256 scalar/);
});

test('hybrid semantic search combines deterministic lexical and embedding ranks', async () => {
  let graph = createGraph('Film');
  const maya = createCreativeObjectOperations(graph, { name: 'Maya', objectType: 'person', tags: ['hero'] });
  graph = applyOperations(graph, maya);
  const product = createCreativeObjectOperations(graph, { name: 'Product', objectType: 'product', tags: ['hero'] });
  graph = applyOperations(graph, product);
  const index = await createSemanticEmbeddingIndex(graph, embedRouter(), { kinds: ['object'] });
  const hybrid = searchSemanticHybrid(graph, index, 'hero Maya', [1, 0, 0], { kinds: ['object'] });
  assert.equal(hybrid[0].id, maya[0].node.id);
});
