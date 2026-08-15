import assert from 'node:assert/strict';
import test from 'node:test';
import { createGraph } from '../../../packages/core/src/graph.js';
import { applyTransaction } from '../../../packages/core/src/operations.js';
import { ModelRouter } from '../../../packages/core/src/model-router.js';
import { GeneratedMediaCommitSession, generatedPayloadBlob } from '../generated-media-commit-session.js';

test('generated media commit session writes payload and graph operations through one commit context', async () => {
  let graph = createGraph('Film');
  let commitArgs;
  const router = new ModelRouter().register({ id: 'image', operations: ['generate-image'], invoke: async () => ({ artifact: { name: 'Frame.png', mimeType: 'image/png' }, payload: new Uint8Array([1, 2, 3]) }) });
  const session = new GeneratedMediaCommitSession({
    router,
    getGraph: () => graph,
    assetUri: (id) => `local://${id}`,
    commit: async (label, operations, metadata, options) => {
      commitArgs = { label, operations, metadata, options };
      graph = applyTransaction(graph, { id: 'tx', label, operations, metadata, createdAt: 'now' });
      return { graph };
    },
  });
  const result = await session.generate({ operation: 'generate-image', intent: 'make frame' });
  assert.equal(result.blob.size, 3);
  assert.equal(result.asset.props.uri, `local://${result.asset.id}`);
  assert.equal(result.asset.props.size, 3);
  assert.equal(commitArgs.metadata.source, 'model');
  assert.equal(commitArgs.options.persistContext.assetWrites[0].assetId, result.asset.id);
  assert.equal(commitArgs.options.persistContext.assetWrites[0].blob.size, 3);
  assert.equal(graph.nodes[result.asset.id].props.uri, `local://${result.asset.id}`);
});

test('generated media commit session rejects declared size mismatch before persistence', async () => {
  const graph = createGraph('Film');
  let committed = false;
  const router = new ModelRouter().register({ id: 'image', operations: ['generate-image'], invoke: async () => ({ artifact: { name: 'Frame.png', mimeType: 'image/png', size: 99 }, payload: new Uint8Array([1, 2, 3]) }) });
  const session = new GeneratedMediaCommitSession({ router, getGraph: () => graph, commit: async () => { committed = true; } });
  await assert.rejects(() => session.generate({ operation: 'generate-image' }), /does not match payload size/);
  assert.equal(committed, false);
});

test('generated media commit keeps persistence failure visible instead of publishing success', async () => {
  const graph = createGraph('Film');
  const router = new ModelRouter().register({ id: 'audio', operations: ['generate-audio'], invoke: async () => ({ artifact: { name: 'Tone.wav', mimeType: 'audio/wav' }, payload: new Uint8Array([1]) }) });
  const session = new GeneratedMediaCommitSession({ router, getGraph: () => graph, commit: async () => { throw new Error('quota'); } });
  await assert.rejects(() => session.generate({ operation: 'generate-audio' }), /quota/);
  assert.equal(Object.values(graph.nodes).some((node) => node.kind === 'asset'), false);
});

test('generatedPayloadBlob accepts Blob ArrayBuffer and typed-array views', () => {
  assert.equal(generatedPayloadBlob(new Uint8Array([1, 2]), 'application/octet-stream').size, 2);
  assert.equal(generatedPayloadBlob(new Uint8Array([1, 2]).buffer, 'application/octet-stream').size, 2);
  assert.equal(generatedPayloadBlob(new Blob(['x'], { type: 'text/plain' }), 'text/plain').size, 1);
});
