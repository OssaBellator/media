import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGENT_PLAN_SCHEMA,
  AgentPlanStaleError,
  agentGraphFingerprint,
  applyAgentPlan,
  createAgentPlan,
  createAgentPlanTransaction,
  inspectAgentPlan,
  previewAgentPlan,
  reviseAgentPlan,
} from '../src/agent-plan.js';
import { createGraph } from '../src/graph.js';
import { applyOperations, applyTransaction } from '../src/operations.js';
import { createPlannerProvider, proposeWithProvider } from '../src/providers.js';

test('agent plan binds validated operations to a semantic graph fingerprint', () => {
  const graph = createGraph('Before');
  const plan = createAgentPlan(graph, {
    intent: 'rename project',
    summary: 'Rename project',
    providerId: 'mock',
    providerLabel: 'Mock',
    operations: [{ type: 'node.update', nodeId: graph.projectId, patch: { name: 'After' } }],
  });
  assert.equal(plan.schema, AGENT_PLAN_SCHEMA);
  assert.equal(plan.base.fingerprint, agentGraphFingerprint(graph));
  assert.equal(previewAgentPlan(graph, plan).graph.nodes[graph.projectId].name, 'After');
  assert.deepEqual(inspectAgentPlan(plan).operationCounts, { 'node.update': 1 });
});

test('agent plan fingerprint ignores volatile node timestamps but detects semantic changes', () => {
  const graph = createGraph('Before');
  const timestampOnly = { ...graph, nodes: { ...graph.nodes, [graph.projectId]: { ...graph.nodes[graph.projectId], updatedAt: '2099-01-01T00:00:00.000Z' } } };
  assert.equal(agentGraphFingerprint(timestampOnly), agentGraphFingerprint(graph));
  const changed = applyOperations(graph, [{ type: 'node.update', nodeId: graph.projectId, patch: { name: 'Changed elsewhere' } }]);
  assert.notEqual(agentGraphFingerprint(changed), agentGraphFingerprint(graph));
});

test('stale agent plan cannot be previewed or applied after the project changes', () => {
  const graph = createGraph('Before');
  const plan = createAgentPlan(graph, { intent: 'rename', providerId: 'mock', operations: [{ type: 'node.update', nodeId: graph.projectId, patch: { name: 'Planned' } }] });
  const changed = applyOperations(graph, [{ type: 'node.update', nodeId: graph.projectId, patch: { name: 'Manual edit' } }]);
  assert.throws(() => applyAgentPlan(changed, plan), (error) => error instanceof AgentPlanStaleError && error.code === 'AGENT_PLAN_STALE');
});

test('agent plan revisions let a human edit the proposed operations before approval', () => {
  const graph = createGraph('Before');
  const plan = createAgentPlan(graph, { intent: 'rename', summary: 'Model choice', providerId: 'mock', operations: [{ type: 'node.update', nodeId: graph.projectId, patch: { name: 'Model' } }] });
  const revised = reviseAgentPlan(graph, plan, [{ type: 'node.update', nodeId: graph.projectId, patch: { name: 'Human' } }], { summary: 'Human choice' });
  assert.equal(revised.id, plan.id);
  assert.equal(revised.revision, 2);
  assert.equal(revised.summary, 'Human choice');
  assert.equal(applyAgentPlan(graph, revised).nodes[graph.projectId].name, 'Human');
});

test('approved agent plan creates an ordinary transaction with durable provenance', () => {
  const graph = createGraph('Before');
  const plan = createAgentPlan(graph, { intent: 'rename', summary: 'Rename', providerId: 'mock', operations: [{ type: 'node.update', nodeId: graph.projectId, patch: { name: 'After' } }] });
  const transaction = createAgentPlanTransaction(graph, plan, { metadata: { workspace: 'agent' } });
  assert.equal(transaction.metadata.source, 'agent');
  assert.equal(transaction.metadata.workspace, 'agent');
  assert.equal(transaction.metadata.agentPlan.id, plan.id);
  assert.equal(transaction.metadata.agentPlan.revision, 1);
  assert.equal(applyTransaction(graph, transaction).nodes[graph.projectId].name, 'After');
});

test('agent plan creation preflights the whole operation batch', () => {
  const graph = createGraph('Before');
  assert.throws(() => createAgentPlan(graph, { intent: 'break it', providerId: 'mock', operations: [{ type: 'node.remove', nodeId: graph.projectId }] }), /project root cannot be removed/);
});

test('planner providers can produce graph-bound preflighted agent plans', async () => {
  const graph = createGraph('Before');
  const provider = createPlannerProvider({
    id: 'mock',
    label: 'Mock model',
    capabilities: ['plan', 'remote'],
    plan: async () => ({ summary: 'Rename', operations: [{ type: 'node.update', nodeId: graph.projectId, patch: { name: 'After' } }] }),
  });
  const proposal = await proposeWithProvider(provider, graph, ' rename it ');
  assert.equal(proposal.intent, 'rename it');
  assert.equal(proposal.provider.id, 'mock');
  assert.deepEqual(proposal.metadata.providerCapabilities, ['plan', 'remote']);
  assert.equal(applyAgentPlan(graph, proposal).nodes[graph.projectId].name, 'After');
});

test('provider proposals reject batches that cannot apply to the current graph', async () => {
  const graph = createGraph('Before');
  const provider = createPlannerProvider({ id: 'bad', plan: async () => ({ summary: 'Bad', operations: [{ type: 'node.update', nodeId: 'missing', patch: { name: 'Nope' } }] }) });
  await assert.rejects(() => proposeWithProvider(provider, graph, 'do it'), /Unknown node/);
});
