import test from 'node:test';
import assert from 'node:assert/strict';
import { createCreativeObjectOperations } from '../../../packages/core/src/creative-object.js';
import { createGraph } from '../../../packages/core/src/graph.js';
import { ModelRouter } from '../../../packages/core/src/model-router.js';
import { applyOperations } from '../../../packages/core/src/operations.js';
import { SEMANTIC_EMBEDDING_INDEX_SCHEMA, semanticEmbeddingSourceFingerprint } from '../../../packages/core/src/semantic-embedding.js';
import { SemanticEmbeddingCache } from '../semantic-embedding-cache.js';

function router() { return { execute() {}, list() { return [{ id: 'b1' }]; } }; }
function embeddingRouter() {
  return new ModelRouter().register({
    id: 'embedder',
    operations: ['embed'],
    invoke: async (_operation, input) => ({ vectors: input.texts.map(() => [1, 0, 0]) }),
  });
}
function record(key, { projectId, sourceFingerprint = 'stale', kinds = null, schema = SEMANTIC_EMBEDDING_INDEX_SCHEMA } = {}) {
  return { key, metadata: { schema, projectId, sourceFingerprint, kinds } };
}

test('prunes stale embedding artifacts only for the same project and semantic scope', async () => {
  const graph = createGraph('Prune');
  const current = semanticEmbeddingSourceFingerprint(graph);
  const removed = [];
  const cache = new SemanticEmbeddingCache({
    router: router(),
    list: async () => [
      record('semantic-embedding:old-null', { projectId: graph.projectId }),
      record('semantic-embedding:current-null', { projectId: graph.projectId, sourceFingerprint: current }),
      record('semantic-embedding:other-project', { projectId: 'other-project' }),
      record('semantic-embedding:kinds', { projectId: graph.projectId, kinds: ['object'] }),
      record('semantic-embedding:other-schema', { projectId: graph.projectId, schema: 'other' }),
    ],
    remove: async (key) => { removed.push(key); return true; },
  });
  const result = await cache.pruneStale(graph);
  assert.deepEqual(removed, ['semantic-embedding:old-null']);
  assert.equal(result.removed, 1);
  assert.equal(result.retained, 1);
  assert.equal(result.failed, 0);
});

test('normalizes kind scopes and preserves current fingerprints across backends', async () => {
  const graph = createGraph('Kinds');
  const kinds = ['asset', 'object'];
  const current = semanticEmbeddingSourceFingerprint(graph, { kinds });
  const removed = [];
  const cache = new SemanticEmbeddingCache({
    router: router(),
    list: async () => [
      record('semantic-embedding:old', { projectId: graph.projectId, kinds: ['object', 'asset'] }),
      record('semantic-embedding:current-a', { projectId: graph.projectId, sourceFingerprint: current, kinds: ['asset', 'object'] }),
      record('semantic-embedding:current-b', { projectId: graph.projectId, sourceFingerprint: current, kinds: ['object', 'asset'] }),
    ],
    remove: async (key) => { removed.push(key); return true; },
  });
  const result = await cache.pruneStale(graph, { kinds: ['object', 'asset', 'asset'] });
  assert.deepEqual(removed, ['semantic-embedding:old']);
  assert.equal(result.retained, 2);
  assert.deepEqual(result.kinds, kinds);
});

test('reports removal failures without mutating graph or other derived scopes', async () => {
  const graph = createGraph('Failure');
  const before = structuredClone(graph);
  const cache = new SemanticEmbeddingCache({
    router: router(),
    list: async () => [record('semantic-embedding:old', { projectId: graph.projectId })],
    remove: async () => false,
  });
  const result = await cache.pruneStale(graph);
  assert.equal(result.failed, 1);
  assert.deepEqual(graph, before);
});

test('getOrCreate prunes stale derived indexes once per visible fingerprint and scope', async () => {
  let graph = createGraph('Automatic prune');
  graph = applyOperations(graph, createCreativeObjectOperations(graph, { name: 'Maya', objectType: 'person' }));
  const records = new Map();
  records.set('semantic-embedding:stale', record('semantic-embedding:stale', { projectId: graph.projectId, kinds: ['object'] }));
  let listCalls = 0;
  const cache = new SemanticEmbeddingCache({
    router: embeddingRouter(),
    load: async (key) => records.get(key) ?? null,
    save: async (key, value, metadata) => { records.set(key, { key, value, metadata }); return true; },
    list: async () => { listCalls += 1; return [...records.values()]; },
    remove: async (key) => records.delete(key),
  });
  const first = await cache.getOrCreate(graph, { kinds: ['object'] });
  const second = await cache.getOrCreate(graph, { kinds: ['object'] });
  assert.equal(first.cachePrune.removed, 1);
  assert.equal(first.cachePrune.retained, 1);
  assert.equal(first.cachePruneError, null);
  assert.equal(second.cached, true);
  assert.equal(second.cachePrune, null);
  assert.equal(listCalls, 1);
  assert.equal(records.has('semantic-embedding:stale'), false);
});

test('automatic prune failure stays inspectable without invalidating a usable index', async () => {
  let graph = createGraph('Prune unavailable');
  graph = applyOperations(graph, createCreativeObjectOperations(graph, { name: 'Maya', objectType: 'person' }));
  const cache = new SemanticEmbeddingCache({
    router: embeddingRouter(),
    load: async () => null,
    save: async () => true,
    list: async () => { throw new Error('derived list unavailable'); },
    remove: async () => true,
  });
  const result = await cache.getOrCreate(graph, { kinds: ['object'] });
  assert.equal(result.cached, false);
  assert.ok(result.index.documents.length > 0);
  assert.equal(result.cachePrune, null);
  assert.match(result.cachePruneError.message, /derived list unavailable/);
});
