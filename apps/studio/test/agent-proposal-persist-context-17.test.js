import assert from 'node:assert/strict';
import test from 'node:test';
import { createGraph } from '../../../packages/core/src/graph.js';
import { applyTransaction } from '../../../packages/core/src/operations.js';
import { createPlannerProvider } from '../../../packages/core/src/providers.js';
import { AgentProposalSession } from '../agent-proposal-session.js';

test('Agent proposal apply filters pending asset writes to the selected materialized operations', async () => {
  let graph = createGraph('Before');
  let commitOptions;
  const provider = createPlannerProvider({ id: 'assets', plan: async () => ({ summary: 'Add assets', operations: [
    { type: 'node.add', node: { id: 'a1', kind: 'asset', name: 'A1', createdAt: 'x', updatedAt: 'x', props: { mediaKind: 'image', mimeType: 'image/png' } } },
    { type: 'node.add', node: { id: 'a2', kind: 'asset', name: 'A2', createdAt: 'x', updatedAt: 'x', props: { mediaKind: 'image', mimeType: 'image/png' } } },
  ] }) });
  const session = new AgentProposalSession({
    provider,
    getGraph: () => graph,
    commit: async (label, operations, metadata, options) => {
      commitOptions = options;
      graph = applyTransaction(graph, { id: 'tx-assets', label, operations, metadata, createdAt: 'now' });
    },
  });
  await session.propose('add assets');
  await session.apply({ operationIndexes: [1], persistContext: { assetWrites: [{ assetId: 'a1', blob: new Blob(['1']) }, { assetId: 'a2', blob: new Blob(['2']) }] } });
  assert.deepEqual(commitOptions.persistContext.assetWrites.map((write) => write.assetId), ['a2']);
  assert.equal(graph.nodes.a1, undefined);
  assert.ok(graph.nodes.a2);
});
