import test from 'node:test';
import assert from 'node:assert/strict';
import { addEdge, addNode } from '../src/graph.js';
import { applyOperations } from '../src/operations.js';
import { createAsset, addAsset, createClipForAsset, createMediaProject } from '../src/project.js';
import { createCreativeObjectOperations, linkCreativeObjectOperations } from '../src/creative-object.js';
import { createGeneratedAssetOperations, createGenerationRecord } from '../src/generated-media.js';
import {
  createCreativeObjectRestylePlan,
  materializeCreativeObjectRestyleOperations,
  resolveCreativeObjectRepresentations,
  restyleOperationForAsset,
} from '../src/object-restyle.js';

function addClip(graph, asset, start) {
  const { clip, edges } = createClipForAsset(graph, asset, start);
  let next = addNode(graph, clip);
  for (const edge of edges) next = addEdge(next, edge);
  return { graph: next, clip };
}

function fixture() {
  let graph = createMediaProject('Restyle test');
  const image = createAsset({ name: 'Portrait', mimeType: 'image/png', size: 10, uri: 'media://image' });
  const video = createAsset({ name: 'Walk', mimeType: 'video/mp4', size: 20, uri: 'media://video', duration: 6 });
  graph = addAsset(graph, image);
  graph = addAsset(graph, video);
  const firstImage = addClip(graph, image, 0); graph = firstImage.graph;
  const secondImage = addClip(graph, image, 5); graph = secondImage.graph;
  const videoUse = addClip(graph, video, 10); graph = videoUse.graph;
  const createObject = createCreativeObjectOperations(graph, {
    id: 'object-hero',
    name: 'Hero',
    objectType: 'subject',
    semanticId: 'hero',
    generationHistory: [{ id: 'existing', at: '2026-01-01T00:00:00.000Z', type: 'manual' }],
  });
  graph = applyOperations(graph, createObject);
  const objectId = createObject[0].node.id;
  graph = applyOperations(graph, linkCreativeObjectOperations(graph, objectId, image.id, { role: 'source-representation' }));
  graph = applyOperations(graph, linkCreativeObjectOperations(graph, objectId, firstImage.clip.id, { role: 'tracked-representation' }));
  graph = applyOperations(graph, linkCreativeObjectOperations(graph, objectId, videoUse.clip.id, { role: 'appears-in' }));
  return { graph, objectId, image, video, firstImage: firstImage.clip, secondImage: secondImage.clip, videoUse: videoUse.clip };
}

function replacement(graph, objectId, sourceAsset, operation, parentPlanId = 'agent-plan-restyle') {
  const isVideo = operation === 'edit-video';
  const generation = createGenerationRecord({
    id: `generation-${sourceAsset.id}`,
    operation,
    backendId: 'test-model',
    intent: 'restyle hero',
    parentPlanId,
    sourceNodeIds: [sourceAsset.id],
    createdAt: '2026-01-02T00:00:00.000Z',
  });
  const materialized = createGeneratedAssetOperations(graph, {
    artifact: {
      name: `${sourceAsset.name} restyled`,
      mimeType: isVideo ? 'video/mp4' : 'image/png',
      size: isVideo ? 22 : 12,
      uri: `generated://${sourceAsset.id}`,
      ...(isVideo ? { duration: 6 } : {}),
    },
    generation,
    sourceNodeIds: [sourceAsset.id],
    creativeObjectIds: [objectId],
  });
  return { sourceAssetId: sourceAsset.id, generation, asset: materialized.asset, operations: materialized.operations };
}

test('resolves direct and clip relationships to unique asset representations', () => {
  const value = fixture();
  const representations = resolveCreativeObjectRepresentations(value.graph, value.objectId);
  assert.deepEqual(representations.map((entry) => entry.assetId), [value.image.id, value.video.id].sort());
  const imageRepresentation = representations.find((entry) => entry.assetId === value.image.id);
  assert.equal(imageRepresentation.relationshipIds.length, 2);
  assert.deepEqual(imageRepresentation.consumerNodeIds, [value.firstImage.id, value.secondImage.id].sort());
});

test('maps supported representation media kinds to edit capabilities', () => {
  const value = fixture();
  assert.equal(restyleOperationForAsset(value.image), 'edit-image');
  assert.equal(restyleOperationForAsset(value.video), 'edit-video');
  assert.equal(restyleOperationForAsset({ id: 'music', kind: 'asset', props: { mediaKind: 'music' } }), 'edit-audio');
});

test('materializes generated provenance, rewires all consumers, and coalesces object history', () => {
  const value = fixture();
  const imageReplacement = replacement(value.graph, value.objectId, value.image, 'edit-image');
  const videoReplacement = replacement(value.graph, value.objectId, value.video, 'edit-video');
  const result = materializeCreativeObjectRestyleOperations(value.graph, {
    objectId: value.objectId,
    replacements: [imageReplacement, videoReplacement],
  });
  assert.equal(result.graph.nodes[value.firstImage.id].props.assetId, imageReplacement.asset.id);
  assert.equal(result.graph.nodes[value.secondImage.id].props.assetId, imageReplacement.asset.id);
  assert.equal(result.graph.nodes[value.videoUse.id].props.assetId, videoReplacement.asset.id);
  assert.ok(result.graph.nodes[value.image.id]);
  assert.ok(result.graph.nodes[value.video.id]);
  assert.equal(result.graph.nodes[value.objectId].props.generationHistory.length, 3);
  assert.equal(result.operations.filter((operation) => operation.type === 'node.update' && operation.nodeId === value.objectId).length, 1);
  for (const clipId of [value.firstImage.id, value.secondImage.id]) {
    assert.ok(Object.values(result.graph.edges).some((edge) => edge.type === 'references' && edge.from === clipId && edge.to === imageReplacement.asset.id));
  }
  assert.ok(Object.values(result.graph.edges).some((edge) => edge.type === 'derives-from' && edge.from === imageReplacement.asset.id && edge.to === value.image.id));
  assert.ok(Object.values(result.graph.edges).some((edge) => edge.type === 'relates-to' && edge.from === value.objectId && edge.to === imageReplacement.asset.id && edge.props?.role === 'generated-representation'));
});

test('requires exactly one generated replacement per resolved representation', () => {
  const value = fixture();
  const imageReplacement = replacement(value.graph, value.objectId, value.image, 'edit-image');
  assert.throws(() => materializeCreativeObjectRestyleOperations(value.graph, { objectId: value.objectId, replacements: [imageReplacement] }), /one replacement for each/);
});

test('rejects generated bundles that mutate the Creative Object beyond generation history', () => {
  const value = fixture();
  const imageReplacement = replacement(value.graph, value.objectId, value.image, 'edit-image');
  const videoReplacement = replacement(value.graph, value.objectId, value.video, 'edit-video');
  imageReplacement.operations.unshift({ type: 'node.update', nodeId: value.objectId, patch: { props: { attributes: { hiddenMutation: true } } } });
  assert.throws(() => materializeCreativeObjectRestyleOperations(value.graph, { objectId: value.objectId, replacements: [imageReplacement, videoReplacement] }), /may not mutate/);
});

test('creates one graph-bound atomic review plan with compact replacement metadata', () => {
  const value = fixture();
  const imageReplacement = replacement(value.graph, value.objectId, value.image, 'edit-image');
  const videoReplacement = replacement(value.graph, value.objectId, value.video, 'edit-video');
  const result = createCreativeObjectRestylePlan(value.graph, {
    id: 'agent-plan-restyle',
    objectId: value.objectId,
    intent: 'make the hero neon',
    replacements: [imageReplacement, videoReplacement],
  });
  assert.equal(result.plan.id, 'agent-plan-restyle');
  assert.equal(result.plan.metadata.creativeObjectRestyle.atomic, true);
  assert.equal(result.plan.metadata.creativeObjectRestyle.replacements.length, 2);
  assert.equal('consumerNodeIds' in result.plan.metadata.creativeObjectRestyle.replacements[0], false);
  assert.match(result.plan.summary, /2 representations/);
});
