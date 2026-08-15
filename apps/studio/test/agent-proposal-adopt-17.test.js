import assert from 'node:assert/strict';
import test from 'node:test';
import { createGraph } from '../../../packages/core/src/graph.js';
import { createAgentPlan } from '../../../packages/core/src/agent-plan.js';
import { applyTransaction } from '../../../packages/core/src/operations.js';
import { createPlannerProvider } from '../../../packages/core/src/providers.js';
import { AgentProposalSession } from '../agent-proposal-session.js';

function provider() {
  return createPlannerProvider({ id: 'mock', plan: async () => ({ summary: 'noop', operations: [] }) });
}

test('Agent proposal session adopts a prebuilt workflow result into the normal review/apply lifecycle', async () => {
  let graph = createGraph('Before');
  const prebuilt = createAgentPlan(graph, { intent: 'workflow result', summary: 'Ready for review', providerId: 'workflow', operations: [{ type: 'node.update', nodeId: graph.projectId, patch: { name: 'After workflow' } }] });
  const session = new AgentProposalSession({
    provider: provider(),
    getGraph: () => graph,
    commit: async (label, operations, metadata) => { graph = applyTransaction(graph, { id: 'tx-workflow', label, operations, metadata, createdAt: 'now' }); },
  });
  const state = session.adopt(prebuilt);
  assert.equal(state.status, 'pending');
  assert.equal(state.plan.id, prebuilt.id);
  assert.equal(state.review.operations[0].summary, 'Update Before');
  await session.apply();
  assert.equal(graph.nodes[graph.projectId].name, 'After workflow');
});

test('Agent proposal session refuses to adopt a plan bound to another project state', () => {
  const graph = createGraph('Before');
  const other = createGraph('Other');
  const plan = createAgentPlan(other, { intent: 'wrong graph', providerId: 'workflow', operations: [] });
  const session = new AgentProposalSession({ provider: provider(), getGraph: () => graph, commit: async () => {} });
  assert.throws(() => session.adopt(plan), (error) => error.code === 'AGENT_PLAN_STALE');
  assert.equal(session.snapshot().status, 'idle');
});
