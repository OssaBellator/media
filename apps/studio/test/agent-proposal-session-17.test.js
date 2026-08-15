import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentProposalSession } from '../agent-proposal-session.js';
import { createGraph } from '../../../packages/core/src/graph.js';
import { applyOperations, applyTransaction } from '../../../packages/core/src/operations.js';
import { createPlannerProvider } from '../../../packages/core/src/providers.js';

function renameProvider(graph) {
  return createPlannerProvider({ id: 'mock', label: 'Mock', plan: async () => ({ summary: 'Rename project', operations: [
    { type: 'node.update', nodeId: graph.projectId, patch: { name: 'Agent name' } },
    { type: 'node.update', nodeId: graph.projectId, patch: { props: { note: 'agent note' } } },
  ] }) });
}

test('Agent proposal session proposes and reviews without mutating the project', async () => {
  const original = createGraph('Before');
  let graph = original;
  const session = new AgentProposalSession({ provider: renameProvider(graph), getGraph: () => graph, commit: async () => { throw new Error('should not commit'); } });
  const state = await session.propose('rename it');
  assert.equal(state.status, 'pending');
  assert.equal(state.review.operations.length, 2);
  assert.equal(graph, original);
  assert.equal(graph.nodes[graph.projectId].name, 'Before');
});

test('Agent proposal apply commits ordinary transaction provenance and clears pending state', async () => {
  let graph = createGraph('Before');
  let committedMetadata;
  const session = new AgentProposalSession({
    provider: renameProvider(graph),
    getGraph: () => graph,
    commit: async (label, operations, metadata) => {
      committedMetadata = metadata;
      graph = applyTransaction(graph, { id: 'tx', label, operations, metadata, createdAt: new Date().toISOString() });
      return { graph };
    },
  });
  await session.propose('rename it');
  const applied = await session.apply({ metadata: { workspace: 'agent' } });
  assert.equal(graph.nodes[graph.projectId].name, 'Agent name');
  assert.equal(committedMetadata.source, 'agent');
  assert.equal(committedMetadata.workspace, 'agent');
  assert.equal(committedMetadata.agentPlan.id, applied.plan.id);
  assert.equal(session.snapshot().status, 'idle');
});

test('Agent proposal selection revises the pending plan before apply', async () => {
  let graph = createGraph('Before');
  const session = new AgentProposalSession({
    provider: renameProvider(graph),
    getGraph: () => graph,
    commit: async (label, operations, metadata) => { graph = applyTransaction(graph, { id: 'tx', label, operations, metadata, createdAt: 'now' }); },
  });
  await session.propose('edit it');
  const selected = session.select([1], { summary: 'Keep note only' });
  assert.equal(selected.plan.revision, 2);
  assert.equal(selected.review.operations.length, 1);
  await session.apply();
  assert.equal(graph.nodes[graph.projectId].name, 'Before');
  assert.equal(graph.nodes[graph.projectId].props.note, 'agent note');
});

test('Agent proposal session reports stale state and refuses apply after project change', async () => {
  let graph = createGraph('Before');
  const session = new AgentProposalSession({ provider: renameProvider(graph), getGraph: () => graph, commit: async () => {} });
  await session.propose('rename it');
  graph = applyOperations(graph, [{ type: 'node.update', nodeId: graph.projectId, patch: { name: 'Manual' } }]);
  const state = session.snapshot();
  assert.equal(state.status, 'stale');
  assert.equal(state.error.code, 'AGENT_PLAN_STALE');
  await assert.rejects(() => session.apply(), (error) => error.code === 'AGENT_PLAN_STALE');
  assert.equal(session.hasPending(), true);
});

test('Agent proposal survives commit failure for an explicit retry or discard', async () => {
  const graph = createGraph('Before');
  let attempts = 0;
  const session = new AgentProposalSession({ provider: renameProvider(graph), getGraph: () => graph, commit: async () => { attempts += 1; throw new Error('disk full'); } });
  await session.propose('rename it');
  await assert.rejects(() => session.apply(), /disk full/);
  assert.equal(attempts, 1);
  assert.equal(session.snapshot().status, 'pending');
  const discarded = session.discard();
  assert.ok(discarded);
  assert.equal(session.snapshot().status, 'idle');
});

test('Agent proposal session refuses an empty operation selection', async () => {
  const graph = createGraph('Before');
  const session = new AgentProposalSession({ provider: renameProvider(graph), getGraph: () => graph, commit: async () => {} });
  await session.propose('rename it');
  assert.throws(() => session.select([]), /At least one/);
});
