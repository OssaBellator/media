import assert from 'node:assert/strict';
import test from 'node:test';
import { createGraph, createNode } from '../src/graph.js';
import { applyOperations } from '../src/operations.js';
import { createCreativeObjectOperations } from '../src/creative-object.js';
import { ModelRouter } from '../src/model-router.js';
import { runGeneratedMediaModel } from '../src/generation-runner.js';

test('generation runner routes a model result and returns graph operations while keeping payload ephemeral', async () => {
  let graph = createGraph('Film');
  const source = createNode({ id: 'source', kind: 'asset', name: 'Source.png', props: { mediaKind: 'image', mimeType: 'image/png', uri: 'private://source', size: 10 } });
  graph = applyOperations(graph, [{ type: 'node.add', node: source }]);
  const bytes = new Uint8Array([1, 2, 3]);
  let received;
  const router = new ModelRouter().register({ id: 'image-model', operations: ['edit-image'], invoke: async (_operation, input) => { received = input; return { artifact: { name: 'Edited.png', mimeType: 'image/png', uri: 'memory://edited', size: 3 }, payload: bytes, metadata: { model: 'v1' } }; } });
  const result = await runGeneratedMediaModel(router, graph, { operation: 'edit-image', intent: 'Make it blue', sourceNodeIds: ['source'], modelInput: { pixels: bytes }, parentPlanId: 'plan-1' });
  assert.equal(received.sourceGraph.nodes.source.props.uri, undefined);
  assert.equal(result.payload, bytes);
  assert.equal(result.asset.props.generation.parentPlanId, 'plan-1');
  assert.equal('payload' in result.asset.props.generation, false);
  const next = applyOperations(graph, result.operations);
  assert.ok(next.nodes[result.asset.id]);
});

test('generation runner honors Creative Object model access before invoking a backend', async () => {
  let graph = createGraph('Film');
  const objectOps = createCreativeObjectOperations(graph, { name: 'Private person', objectType: 'person', permissions: { modelAccess: 'none' } });
  graph = applyOperations(graph, objectOps);
  let called = false;
  const router = new ModelRouter().register({ id: 'model', operations: ['generate-image'], invoke: async () => { called = true; return { artifact: { name: 'x.png', mimeType: 'image/png' } }; } });
  await assert.rejects(() => runGeneratedMediaModel(router, graph, { operation: 'generate-image', creativeObjectIds: [objectOps[0].node.id] }), /does not permit model access/);
  assert.equal(called, false);
});

test('generation runner uses model routing policy for sensitive local-only work', async () => {
  const graph = createGraph('Film');
  const router = new ModelRouter()
    .register({ id: 'remote', operations: ['generate-audio'], priority: 10, location: 'remote', invoke: async () => ({ artifact: { name: 'r.wav', mimeType: 'audio/wav' } }) })
    .register({ id: 'local', operations: ['generate-audio'], priority: 1, location: 'local', invoke: async () => ({ artifact: { name: 'l.wav', mimeType: 'audio/wav' } }) });
  const result = await runGeneratedMediaModel(router, graph, { operation: 'generate-audio', policy: { dataPolicy: 'local' } });
  assert.equal(result.backendId, 'local');
  assert.equal(result.asset.name, 'l.wav');
});

test('generation runner rejects malformed model artifact contracts before creating graph operations', async () => {
  const graph = createGraph('Film');
  const router = new ModelRouter().register({ id: 'bad', operations: ['generate-video'], invoke: async () => ({ artifact: { name: 'missing-mime' } }) });
  await assert.rejects(() => runGeneratedMediaModel(router, graph, { operation: 'generate-video' }), /mimeType/);
});
