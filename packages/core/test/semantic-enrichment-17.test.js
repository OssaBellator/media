import assert from 'node:assert/strict';
import test from 'node:test';
import { createGraph, createNode, nodesByKind } from '../src/graph.js';
import { applyOperations } from '../src/operations.js';
import { ModelRouter } from '../src/model-router.js';
import { createSemanticEnrichmentOperations, MAX_SEMANTIC_MODEL_SOURCE_IDS, runSemanticEnrichmentModel } from '../src/semantic-enrichment.js';

test('semantic enrichment materializes detected people as Creative Objects linked to source media', () => {
  let graph = createGraph('Film');
  const source = createNode({ id: 'asset_video', kind: 'asset', name: 'Take.mp4', props: { mediaKind: 'video', mimeType: 'video/mp4', uri: 'private://take' } });
  graph = applyOperations(graph, [{ type: 'node.add', node: source }]);
  const result = createSemanticEnrichmentOperations(graph, { objects: [{ name: 'Maya', objectType: 'person', semanticId: 'person:maya', confidence: .93, tags: ['cast'], relationships: [{ targetId: source.id, role: 'appears-in', time: { start: 1, end: 3 }, tracking: { method: 'mask' } }] }] }, { provenance: { analyzer: 'vision-v1' } });
  graph = applyOperations(graph, result.operations);
  const object = graph.nodes[result.objectIds[0]];
  assert.equal(object.props.semanticId, 'person:maya');
  assert.equal(object.props.provenance.analyzer, 'vision-v1');
  assert.equal(Object.values(graph.edges).some((edge) => edge.from === object.id && edge.to === source.id && edge.props.role === 'appears-in'), true);
});

test('repeated enrichment updates a stable semantic identity instead of creating a duplicate object', () => {
  let graph = createGraph('Film');
  const first = createSemanticEnrichmentOperations(graph, { objects: [{ name: 'Maya', objectType: 'person', semanticId: 'person:maya', confidence: .7, semantics: { mood: 'neutral' } }] });
  graph = applyOperations(graph, first.operations);
  const second = createSemanticEnrichmentOperations(graph, { objects: [{ name: 'Maya', objectType: 'person', semanticId: 'person:maya', confidence: .95, semantics: { mood: 'happy' } }] });
  graph = applyOperations(graph, second.operations);
  assert.equal(nodesByKind(graph, 'object').length, 1);
  const object = nodesByKind(graph, 'object')[0];
  assert.equal(object.props.confidence, .95);
  assert.equal(object.props.semantics.mood, 'happy');
});

test('semantic enrichment can relate newly-created objects by semantic identity', () => {
  const graph = createGraph('Film');
  const result = createSemanticEnrichmentOperations(graph, { objects: [
    { name: 'Maya', objectType: 'person', semanticId: 'person:maya' },
    { name: 'Jacket', objectType: 'wardrobe', semanticId: 'wardrobe:jacket', relationships: [{ targetSemanticId: 'person:maya', role: 'worn-by' }] },
  ] });
  const next = applyOperations(graph, result.operations);
  const [mayaId, jacketId] = result.objectIds;
  assert.equal(Object.values(next.edges).some((edge) => edge.from === jacketId && edge.to === mayaId && edge.props.role === 'worn-by'), true);
});

test('semantic enrichment deduplicates repeated relationships and refreshes changed tracking metadata', () => {
  let graph = createGraph('Film');
  const source = createNode({ id: 'source', kind: 'asset', name: 'x', props: { mediaKind: 'image', mimeType: 'image/png' } });
  graph = applyOperations(graph, [{ type: 'node.add', node: source }]);
  const firstPayload = { objects: [{ name: 'Product', objectType: 'product', semanticId: 'p:1', relationships: [{ targetId: source.id, role: 'depicts', tracking: { revision: 1 } }] }] };
  const first = createSemanticEnrichmentOperations(graph, firstPayload);
  graph = applyOperations(graph, first.operations);
  const firstEdge = Object.values(graph.edges).find((edge) => edge.type === 'relates-to' && edge.props.role === 'depicts');
  const second = createSemanticEnrichmentOperations(graph, firstPayload);
  graph = applyOperations(graph, second.operations);
  assert.equal(Object.values(graph.edges).filter((edge) => edge.type === 'relates-to' && edge.props.role === 'depicts').length, 1);
  const updated = createSemanticEnrichmentOperations(graph, { objects: [{ name: 'Product', objectType: 'product', semanticId: 'p:1', relationships: [{ targetId: source.id, role: 'depicts', tracking: { revision: 2 } }] }] });
  graph = applyOperations(graph, updated.operations);
  const edge = Object.values(graph.edges).find((item) => item.type === 'relates-to' && item.props.role === 'depicts');
  assert.equal(edge.id, firstEdge.id);
  assert.equal(edge.props.tracking.revision, 2);
});

test('semantic enrichment validates bounds and relationship targets before returning work', () => {
  const graph = createGraph('Film');
  assert.throws(() => createSemanticEnrichmentOperations(graph, { objects: [{ name: 'x', objectType: 'thing', relationships: [{ targetId: 'missing', role: 'depicts' }] }] }), /Unknown semantic enrichment relationship target/);
  assert.throws(() => createSemanticEnrichmentOperations(graph, { objects: Array.from({ length: 1025 }, (_, index) => ({ name: `x${index}`, objectType: 'thing' })) }), /exceeds 1024 objects/);
});

test('semantic enrichment keeps trusted provenance authoritative and rejects semantic type drift', async () => {
  let graph = createGraph('Film');
  const source = createNode({ id: 'source2', kind: 'asset', name: 'Take.mp4', props: { mediaKind: 'video', mimeType: 'video/mp4' } });
  graph = applyOperations(graph, [{ type: 'node.add', node: source }]);
  const router = new ModelRouter().register({ id: 'trusted-backend', operations: ['analyze-media'], invoke: async () => ({ objects: [{ name: 'Maya', objectType: 'person', semanticId: 'person:maya', provenance: { backendId: 'forged', source: 'forged' } }] }) });
  const result = await runSemanticEnrichmentModel(router, graph, { sourceNodeIds: [source.id] });
  graph = applyOperations(graph, result.operations);
  const object = graph.nodes[result.objectIds[0]];
  assert.equal(object.props.provenance.backendId, 'trusted-backend');
  assert.equal(object.props.provenance.source, 'model-analysis');
  assert.throws(() => createSemanticEnrichmentOperations(graph, { objects: [{ name: 'Not Maya', objectType: 'product', semanticId: 'person:maya' }] }), /type mismatch/);
});

test('semantic enrichment rejects unsafe model inputs and options before backend invocation', async () => {
  const graph = createGraph('Bounded enrichment');
  let calls = 0;
  const router = new ModelRouter().register({ id: 'vision', operations: ['analyze-media'], invoke: async () => { calls += 1; return { objects: [] }; } });
  await assert.rejects(() => runSemanticEnrichmentModel(router, graph, { sourceNodeIds: Array.from({ length: MAX_SEMANTIC_MODEL_SOURCE_IDS + 1 }, (_, index) => `source-${index}`) }), /exceeds 1024 ids/);
  await assert.rejects(() => runSemanticEnrichmentModel(router, graph, { modelInput: { callback() {} } }), /unsupported function data/);
  await assert.rejects(() => runSemanticEnrichmentModel(router, graph, { context: { unsafe: 1n } }), /model context must be JSON-safe/);
  await assert.rejects(() => runSemanticEnrichmentModel(router, graph, { policy: { unsafe: 1n } }), /model policy must be JSON-safe/);
  await assert.rejects(() => runSemanticEnrichmentModel(router, graph, { permissions: { modelAccess: 'full', unsafe: 1n } }), /permissions must be JSON-safe/);
  assert.equal(calls, 0);
});

test('routed semantic enrichment uses privacy-redacted source context and records backend provenance', async () => {
  let graph = createGraph('Film');
  const source = createNode({ id: 'source', kind: 'asset', name: 'Take.mp4', props: { mediaKind: 'video', mimeType: 'video/mp4', uri: 'private://take' } });
  graph = applyOperations(graph, [{ type: 'node.add', node: source }]);
  let input;
  const sourceBytes = new Uint8Array([1]);
  const router = new ModelRouter().register({ id: 'vision', operations: ['analyze-media'], invoke: async (_operation, value) => { input = value; return { objects: [{ name: 'Maya', objectType: 'person', semanticId: 'person:maya', relationships: [{ targetId: source.id, role: 'appears-in' }] }] }; } });
  const result = await runSemanticEnrichmentModel(router, graph, { sourceNodeIds: [source.id], modelInput: { bytes: sourceBytes } });
  assert.equal(input.sourceGraph.nodes.source.props.uri, undefined);
  assert.ok(input.input.bytes instanceof Uint8Array);
  assert.deepEqual([...input.input.bytes], [1]);
  assert.notEqual(input.input.bytes, sourceBytes);
  assert.notEqual(input.input.bytes.buffer, sourceBytes.buffer);
  assert.equal(result.backendId, 'vision');
  const next = applyOperations(graph, result.operations);
  const object = next.nodes[result.objectIds[0]];
  assert.equal(object.props.provenance.backendId, 'vision');
  assert.deepEqual(object.props.provenance.sourceNodeIds, ['source']);
});


test('semantic enrichment output normalization rejects accessors without executing them', () => {
  const graph = createGraph('Accessor output');
  let rootGetterCalls = 0;
  const root = {};
  Object.defineProperty(root, 'objects', { enumerable: true, get() { rootGetterCalls += 1; return []; } });
  assert.throws(() => createSemanticEnrichmentOperations(graph, root), /Semantic enrichment must be JSON-safe/i);
  assert.equal(rootGetterCalls, 0);

  let nestedGetterCalls = 0;
  const entry = { objectType: 'person' };
  Object.defineProperty(entry, 'name', { enumerable: true, get() { nestedGetterCalls += 1; return 'Maya'; } });
  assert.throws(() => createSemanticEnrichmentOperations(graph, { objects: [entry] }), /Semantic enrichment must be JSON-safe/i);
  assert.equal(nestedGetterCalls, 0);
});
