import assert from 'node:assert/strict';
import test from 'node:test';
import { createGraph, createNode } from '../src/graph.js';
import { applyOperations } from '../src/operations.js';
import { createCreativeObjectOperations } from '../src/creative-object.js';
import { buildSourceManifest } from '../src/sources.js';
import { createGeneratedAssetOperations, createGenerationRecord, generatedAssetProvenance } from '../src/generated-media.js';

test('generated media enters the normal asset graph with structured provenance and source relationships', () => {
  let graph = createGraph('Campaign');
  const source = createNode({ id: 'asset_source', kind: 'asset', name: 'Product.jpg', props: { mediaKind: 'image', mimeType: 'image/jpeg', size: 10, uri: 'memory://source' } });
  graph = applyOperations(graph, [{ type: 'node.add', node: source }, { type: 'edge.add', edge: { id: 'contains_source', from: graph.projectId, to: source.id, type: 'contains', props: {} } }]);
  const generation = createGenerationRecord({ operation: 'edit-image', backendId: 'model-a', intent: 'Make the jacket blue', sourceNodeIds: [source.id], parentPlanId: 'plan-1' });
  const { asset, operations } = createGeneratedAssetOperations(graph, { artifact: { name: 'Blue jacket.png', mimeType: 'image/png', size: 123, uri: 'memory://generated', width: 1024, height: 1024, hash: 'abc' }, generation });
  graph = applyOperations(graph, operations);
  assert.equal(graph.nodes[asset.id].props.generated, true);
  assert.equal(graph.nodes[asset.id].props.generation.backendId, 'model-a');
  assert.deepEqual(generatedAssetProvenance(graph, asset.id).sourceNodeIds, [source.id]);
  assert.equal(buildSourceManifest(graph).find((item) => item.id === asset.id).hash, 'abc');
});

test('generated media can become a representation of a Creative Object and updates its generation history', () => {
  let graph = createGraph('Film');
  const objectOps = createCreativeObjectOperations(graph, { name: 'Maya jacket', objectType: 'wardrobe' });
  graph = applyOperations(graph, objectOps);
  const objectId = objectOps[0].node.id;
  const generation = createGenerationRecord({ operation: 'generate-image', backendId: 'image-model', parentPlanId: 'agent-plan' });
  const { asset, operations } = createGeneratedAssetOperations(graph, { artifact: { name: 'Jacket.png', mimeType: 'image/png', size: 10 }, generation, creativeObjectIds: [objectId] });
  graph = applyOperations(graph, operations);
  const provenance = generatedAssetProvenance(graph, asset.id);
  assert.deepEqual(provenance.creativeObjectIds, [objectId]);
  const event = graph.nodes[objectId].props.generationHistory.at(-1);
  assert.equal(event.artifactId, asset.id);
  assert.equal(event.parentPlanId, 'agent-plan');
});

test('generated media validates operation modality and all dependency identities before emitting operations', () => {
  const graph = createGraph('Film');
  assert.throws(() => createGenerationRecord({ operation: 'plan', backendId: 'x' }), /Unsupported generated media operation/);
  const generation = createGenerationRecord({ operation: 'generate-video', backendId: 'x' });
  assert.throws(() => createGeneratedAssetOperations(graph, { artifact: { name: 'wrong.png', mimeType: 'image/png' }, generation }), /does not match/);
  assert.throws(() => createGeneratedAssetOperations(graph, { artifact: { name: 'clip.mp4', mimeType: 'video/mp4' }, generation, sourceNodeIds: ['missing'] }), /Unknown generation source node/);
});

test('generation source identities are deduplicated in records and graph edges', () => {
  let graph = createGraph('Film');
  const source = createNode({ id: 'source', kind: 'asset', name: 'Source', props: { mediaKind: 'image', mimeType: 'image/png', size: 1, uri: '' } });
  graph = applyOperations(graph, [{ type: 'node.add', node: source }]);
  const generation = createGenerationRecord({ operation: 'generate-image', backendId: 'x', sourceNodeIds: ['source', 'source'] });
  const { asset, operations } = createGeneratedAssetOperations(graph, { artifact: { name: 'out.png', mimeType: 'image/png' }, generation, sourceNodeIds: ['source', 'source'] });
  graph = applyOperations(graph, operations);
  assert.deepEqual(graph.nodes[asset.id].props.generation.sourceNodeIds, ['source']);
  assert.equal(Object.values(graph.edges).filter((edge) => edge.from === asset.id && edge.type === 'derives-from').length, 1);
});

test('generated asset materialization rejects forged and oversized generation records', () => {
  const graph = createGraph('Film');
  const forged = { schema: 'media.generation-record.v1', id: 'g', operation: 'generate-image', backendId: '', intent: '', settings: {}, parentPlanId: null, sourceNodeIds: [], createdAt: 'now', metadata: {} };
  assert.throws(() => createGeneratedAssetOperations(graph, { artifact: { name: 'out.png', mimeType: 'image/png' }, generation: forged }), /backendId/);
  assert.throws(() => createGenerationRecord({ operation: 'generate-image', backendId: 'x', intent: 'x'.repeat(16 * 1024 + 1) }), /intent exceeds/);
  assert.throws(() => createGenerationRecord({ operation: 'generate-image', backendId: 'x', metadata: { huge: 'x'.repeat(70 * 1024) } }), /record exceeds/);
});
