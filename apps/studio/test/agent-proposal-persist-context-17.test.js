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
  const persistContext = { assetWrites: [{ assetId: 'a1', blob: new Blob(['1']), metadata: { name: 'one' } }, { assetId: 'a2', blob: new Blob(['2']), metadata: { name: 'two' } }] };
  const pending = session.apply({ operationIndexes: [1], persistContext });
  persistContext.assetWrites[1].assetId = 'mutated';
  persistContext.assetWrites[1].metadata.name = 'mutated';
  await pending;
  assert.deepEqual(commitOptions.persistContext.assetWrites.map((write) => write.assetId), ['a2']);
  assert.equal(commitOptions.persistContext.assetWrites[0].metadata.name, 'two');
  assert.equal(graph.nodes.a1, undefined);
  assert.ok(graph.nodes.a2);
});

test('Agent proposal apply rejects accessor options and coercive persistence identities before commit', async () => {
  const graph = createGraph('Before');
  let commitCalls = 0, getterCalls = 0, coercions = 0;
  const provider = createPlannerProvider({ id: 'asset', plan: async () => ({ summary: 'Add asset', operations: [
    { type: 'node.add', node: { id: 'a1', kind: 'asset', name: 'A1', createdAt: 'x', updatedAt: 'x', props: { mediaKind: 'image', mimeType: 'image/png' } } },
  ] }) });
  const session = new AgentProposalSession({ provider, getGraph: () => graph, commit: async () => { commitCalls += 1; } });
  await session.propose('add asset');
  const options = {};
  Object.defineProperty(options, 'persistContext', { enumerable: true, get() { getterCalls += 1; return null; } });
  await assert.rejects(() => session.apply(options), /apply options must contain enumerable data fields only/);
  assert.equal(getterCalls, 0);
  const write = { blob: new Blob(['1']) };
  Object.defineProperty(write, 'assetId', { enumerable: true, get() { getterCalls += 1; return 'a1'; } });
  await assert.rejects(() => session.apply({ persistContext: { assetWrites: [write] } }), /Asset write 0 must contain enumerable data fields only/);
  assert.equal(getterCalls, 0);
  await assert.rejects(() => session.apply({ persistContext: { assetWrites: [{ assetId: { toString() { coercions += 1; return 'a1'; } }, blob: new Blob(['1']) }] } }), /assetId must be a non-empty string/);
  assert.equal(coercions, 0);
  assert.equal(commitCalls, 0);
  assert.equal(session.hasPending(), true);
});
