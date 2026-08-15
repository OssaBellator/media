import test from 'node:test';
import assert from 'node:assert/strict';

test('session-only graph saves still advance the shared in-memory graph cache', async () => {
  const previous = globalThis.indexedDB;
  try {
    delete globalThis.indexedDB;
    const storage = await import(`../storage.js?cache=${Date.now()}`);
    const graph = { projectId: 'p', version: 1, nodes: { p: { id: 'p', kind: 'project', props: {} } }, edges: {} };
    assert.equal(storage.getCachedStoredGraph(), null);
    assert.equal(await storage.saveStoredGraph(graph), false);
    assert.equal(storage.getCachedStoredGraph(), graph);
    assert.equal(await storage.loadStoredGraph(), graph);
  } finally {
    if (previous !== undefined) globalThis.indexedDB = previous;
  }
});
