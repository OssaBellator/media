import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { semanticSearchEmbeddingAvailable } from '../semantic-search-bridge.js';
import { semanticSearchPanelMarkup } from '../semantic-search-panel.js';
import {
  getStudioGraph,
  getStudioModelRouter,
  registerStudioGraphProvider,
  registerStudioModelRouterProvider,
  registerStudioNodeSelector,
  selectStudioNode,
} from '../studio-services.js';

test('Studio services expose only registered canonical graph, selection and optional router seams', () => {
  const graph = { projectId: 'project-1', nodes: { 'project-1': { id: 'project-1', kind: 'project' }, asset: { id: 'asset', kind: 'asset' } } };
  const selected = [];
  const router = { execute() {}, list(operation) { return operation === 'embed' ? [{ id: 'embedder' }] : []; } };
  const restoreGraph = registerStudioGraphProvider(() => graph);
  const restoreSelection = registerStudioNodeSelector((nodeId) => { selected.push(nodeId); return true; });
  const restoreRouter = registerStudioModelRouterProvider(() => router);
  try {
    assert.equal(getStudioGraph(), graph);
    assert.equal(selectStudioNode('asset'), true);
    assert.deepEqual(selected, ['asset']);
    assert.equal(getStudioModelRouter(), router);
    assert.throws(() => selectStudioNode('   '), /non-empty node id/);
  } finally {
    restoreRouter();
    restoreSelection();
    restoreGraph();
  }
});

test('embedding refinement is advertised only for a compatible router with an embed backend', () => {
  assert.equal(semanticSearchEmbeddingAvailable(null), false);
  assert.equal(semanticSearchEmbeddingAvailable({ execute() {}, list() { return []; } }), false);
  assert.equal(semanticSearchEmbeddingAvailable({ execute() {}, list(operation) { return operation === 'embed' ? [{ id: 'local-embed' }] : []; } }), true);
  assert.equal(semanticSearchEmbeddingAvailable({ execute() {}, list() { throw new Error('offline'); } }), false);
  assert.equal(semanticSearchEmbeddingAvailable({ list() { return [{ id: 'embedder' }]; } }), false);
});

test('semantic search panel escapes graph labels and never renders embedding vectors', () => {
  const markup = semanticSearchPanelMarkup({
    status: 'ready',
    mode: 'hybrid',
    query: 'Maya <hero>',
    cache: { cached: true },
    results: [{ id: 'asset-1" onclick="bad', name: '<script>alert(1)</script>', kind: 'asset', vector: [0.125, 0.875] }],
  }, { embeddingAvailable: true, useEmbeddings: true });
  assert.match(markup, /Hybrid ranking · cached derived embeddings/);
  assert.match(markup, /Maya &lt;hero&gt;/);
  assert.match(markup, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(markup, /asset-1&quot; onclick=&quot;bad/);
  assert.doesNotMatch(markup, /0\.125|0\.875|vector/);
  assert.match(markup, /data-semantic-embeddings checked/);
  assert.doesNotMatch(markup, /data-semantic-embeddings checked disabled/);
});

test('semantic search panel keeps lexical search visibly available without an embedding backend', () => {
  const markup = semanticSearchPanelMarkup({ status: 'ready', mode: 'lexical', query: '', results: [] }, { embeddingAvailable: false });
  assert.match(markup, /Local lexical ranking · no embedding backend registered/);
  assert.match(markup, /Lexical search stays local and always available/);
  assert.match(markup, /data-semantic-embeddings checked disabled/);
});

test('Studio bootstrap installs semantic search and runtime registers canonical graph services', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const runtime = await readFile(new URL('../studio-runtime.js', import.meta.url), 'utf8');
  assert.match(app, /installStudioSemanticSearchBridge\(\)/);
  assert.match(runtime, /registerStudioGraphProvider\(graph\)/);
  assert.match(runtime, /registerStudioNodeSelector\(\(nodeId\) =>/);
  assert.doesNotMatch(runtime, /registerStudioModelRouterProvider/);
});
