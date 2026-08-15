import assert from 'node:assert/strict';
import test from 'node:test';
import { createGraph } from '../src/graph.js';
import { applyOperations } from '../src/operations.js';
import { createCreativeObjectOperations } from '../src/creative-object.js';
import { ModelRouter } from '../src/model-router.js';
import { assertPlannerResult, createModelRouterPlannerProvider, proposeWithProvider } from '../src/providers.js';

test('model router planner sends privacy-redacted graph context and records backend provenance', async () => {
  let graph = createGraph('Film');
  const hiddenOps = createCreativeObjectOperations(graph, { name: 'Secret actor', objectType: 'person', permissions: { modelAccess: 'none' } });
  graph = applyOperations(graph, hiddenOps);
  let seenInput;
  const router = new ModelRouter().register({ id: 'planner-a', operations: ['plan'], trusted: true, invoke: async (_operation, input) => { seenInput = input; return { summary: 'Rename', operations: [{ type: 'node.update', nodeId: graph.projectId, patch: { name: 'Planned' } }] }; } });
  const provider = createModelRouterPlannerProvider({ router });
  const plan = await proposeWithProvider(provider, graph, 'rename it');
  assert.equal(seenInput.graph.nodes[hiddenOps[0].node.id], undefined);
  assert.equal(plan.metadata.planner.routing.backendId, 'planner-a');
  assert.equal(plan.metadata.planner.routing.contextMode, 'full');
});

test('semantic model planner sends only relevant bounded context and exposes match ids', async () => {
  let graph = createGraph('Film');
  const mayaOps = createCreativeObjectOperations(graph, { name: 'Maya', objectType: 'person', tags: ['hero'] });
  graph = applyOperations(graph, mayaOps);
  const otherOps = createCreativeObjectOperations(graph, { name: 'Unrelated product', objectType: 'product' });
  graph = applyOperations(graph, otherOps);
  let input;
  const router = new ModelRouter().register({ id: 'semantic', operations: ['plan'], invoke: async (_operation, value) => { input = value; return { summary: 'No-op', operations: [] }; } });
  const provider = createModelRouterPlannerProvider({ router, contextMode: 'semantic', semanticContextOptions: { limit: 3, maxNodes: 8 } });
  const plan = await proposeWithProvider(provider, graph, 'Maya');
  assert.ok(input.graph.nodes[mayaOps[0].node.id]);
  assert.equal(input.graph.nodes[otherOps[0].node.id], undefined);
  assert.deepEqual(plan.metadata.planner.routing.semanticMatchIds, [mayaOps[0].node.id]);
});

test('model planner routing policy can require local execution', async () => {
  const graph = createGraph('Film');
  const router = new ModelRouter()
    .register({ id: 'remote', operations: ['plan'], location: 'remote', priority: 100, invoke: async () => ({ summary: 'remote', operations: [] }) })
    .register({ id: 'local', operations: ['plan'], location: 'local', priority: 1, invoke: async () => ({ summary: 'local', operations: [] }) });
  const provider = createModelRouterPlannerProvider({ router, policy: { dataPolicy: 'local' } });
  const plan = await proposeWithProvider(provider, graph, 'plan safely');
  assert.equal(plan.summary, 'local');
  assert.equal(plan.metadata.planner.routing.backendId, 'local');
});

test('planner result metadata is JSON-safe bounded and normalized', () => {
  assert.deepEqual(assertPlannerResult({ summary: 'ok', operations: [], metadata: { backend: 'x' }, ignored: true }), { summary: 'ok', operations: [], metadata: { backend: 'x' } });
  assert.throws(() => assertPlannerResult({ summary: 'ok', operations: [], metadata: [] }), /metadata must be an object/);
  assert.throws(() => assertPlannerResult({ summary: 'ok', operations: [], metadata: { huge: 'x'.repeat(400) } }, { maxResultBytes: 256 }), /exceeds 256 bytes/);
});
