import test from 'node:test';
import assert from 'node:assert/strict';
import { createGraph } from '../../../packages/core/src/graph.js';
import { SEMANTIC_EMBEDDING_INDEX_SCHEMA, semanticEmbeddingSourceFingerprint } from '../../../packages/core/src/semantic-embedding.js';
import { SemanticEmbeddingCache } from '../semantic-embedding-cache.js';

function router() { return { execute() {}, list() { return [{ id: 'b1' }]; } }; }
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
