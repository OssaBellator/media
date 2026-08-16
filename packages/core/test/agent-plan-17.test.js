import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGENT_PLAN_SCHEMA,
  AgentPlanStaleError,
  agentGraphFingerprint,
  assertAgentPlan,
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

test('agent plan validation returns inert data and never executes accessors', () => {
  const graph = createGraph('Before');
  const plan = createAgentPlan(graph, { intent: 'rename', providerId: 'mock', operations: [] });
  const clean = assertAgentPlan(plan);
  assert.notEqual(clean, plan);
  assert.notEqual(clean.provider, plan.provider);
  plan.provider.label = 'mutated';
  assert.equal(clean.provider.label, 'mock');
  let getterCalls = 0;
  const forged = {};
  Object.defineProperty(forged, 'schema', { enumerable: true, get() { getterCalls += 1; return AGENT_PLAN_SCHEMA; } });
  assert.throws(() => assertAgentPlan(forged), /Agent plan must be JSON-safe/);
  assert.equal(getterCalls, 0);
});

test('agent plan creation rejects accessor options and coercive provider labels without execution', () => {
  const graph = createGraph('Before');
  let getterCalls = 0;
  const options = { providerId: 'mock' };
  Object.defineProperty(options, 'intent', { enumerable: true, get() { getterCalls += 1; return 'rename'; } });
  assert.throws(() => createAgentPlan(graph, options), /plan options must contain enumerable data fields only/);
  let coercions = 0;
  assert.throws(() => createAgentPlan(graph, { intent: 'rename', providerId: 'mock', providerLabel: { toString() { coercions += 1; return 'Mock'; } } }), /provider label must be a string/);
  assert.throws(() => createAgentPlan(graph, { intent: 'rename', providerId: 'mock', revision: '1' }), /revision must be a positive safe integer/);
  assert.equal(getterCalls, 0);
  assert.equal(coercions, 0);
});

test('agent plan preview revision and transaction boundaries never reuse getter-bearing plans or options', () => {
  const graph = createGraph('Before');
  const plan = createAgentPlan(graph, { intent: 'rename', providerId: 'mock', operations: [] });
  let getterCalls = 0;
  const forged = { ...plan };
  Object.defineProperty(forged, 'base', { enumerable: true, get() { getterCalls += 1; return plan.base; } });
  assert.throws(() => previewAgentPlan(graph, forged), /Agent plan must be JSON-safe/);
  assert.throws(() => createAgentPlanTransaction(graph, forged), /Agent plan must be JSON-safe/);
  const revisionOptions = {};
  Object.defineProperty(revisionOptions, 'summary', { enumerable: true, get() { getterCalls += 1; return 'unsafe'; } });
  assert.throws(() => reviseAgentPlan(graph, plan, [], revisionOptions), /revision options must contain enumerable data fields only/);
  assert.equal(getterCalls, 0);
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
