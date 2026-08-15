import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAgentPlanMatchesGraph } from '../src/agent-plan.js';
import { AGENT_WORKFLOW_SCHEMA, MAX_AGENT_WORKFLOW_BYTES, MAX_AGENT_WORKFLOW_TASKS } from '../src/agent-workflow.js';
import { createCreativeObjectOperations } from '../src/creative-object.js';
import { createGraph } from '../src/graph.js';
import { ModelRouter } from '../src/model-router.js';
import { applyOperations } from '../src/operations.js';
import {
  assertWorkflowPlannerResult,
  createModelRouterWorkflowProvider,
  createWorkflowPlannerProvider,
  MAX_PLANNER_CONTEXT_BYTES,
  MAX_PLANNER_INTENT_CHARS,
  proposeAgentWorkflowWithProvider,
} from '../src/providers.js';

test('workflow provider produces a graph-bound Agent workflow without putting task semantics in plan metadata', async () => {
  const graph = createGraph('Workflow proposal');
  const provider = createWorkflowPlannerProvider({
    id: 'workflow-test',
    label: 'Workflow Test',
    proposeWorkflow: async ({ intent, context }) => ({
      summary: `Delegate ${intent}`,
      operations: [],
      tasks: [{ id: 'enrich', kind: 'semantic-enrichment', payload: { sourceNodeIds: [] } }],
      metadata: { requestClass: context.requestClass },
    }),
  });
  const workflow = await proposeAgentWorkflowWithProvider(provider, graph, ' enrich the project ', { requestClass: 'semantic' });
  assert.equal(workflow.schema, AGENT_WORKFLOW_SCHEMA);
  assert.equal(workflow.plan.intent, 'enrich the project');
  assert.equal(workflow.plan.provider.id, 'workflow-test');
  assert.equal(workflow.tasks.length, 1);
  assert.equal(workflow.tasks[0].kind, 'semantic-enrichment');
  assertAgentPlanMatchesGraph(graph, workflow.plan);
  assert.equal(workflow.plan.metadata.workflowPlanner.requestClass, 'semantic');
  assert.equal(JSON.stringify(workflow.plan.metadata).includes('semantic-enrichment'), false);
});

test('workflow provider bounds intent before provider invocation', async () => {
  const graph = createGraph('Workflow intent bound');
  let calls = 0;
  const provider = createWorkflowPlannerProvider({ id: 'intent-bound', proposeWorkflow: async () => { calls += 1; return { summary: 'noop', operations: [], tasks: [] }; } });
  await assert.rejects(() => proposeAgentWorkflowWithProvider(provider, graph, 'x'.repeat(MAX_PLANNER_INTENT_CHARS + 1)), /exceeds 16384 characters/);
  assert.equal(calls, 0);
});

test('workflow provider bounds and normalizes context before provider invocation', async () => {
  const graph = createGraph('Workflow context bound');
  let calls = 0;
  let receivedContext = null;
  const provider = createWorkflowPlannerProvider({ id: 'context-bound', proposeWorkflow: async ({ context }) => { calls += 1; receivedContext = context; return { summary: 'noop', operations: [], tasks: [] }; } });
  const context = { request: { mode: 'safe' } };
  await proposeAgentWorkflowWithProvider(provider, graph, 'delegate', context);
  assert.deepEqual(receivedContext, context);
  assert.notEqual(receivedContext, context);
  await assert.rejects(() => proposeAgentWorkflowWithProvider(provider, graph, 'delegate', { huge: 'x'.repeat(400) }, { maxContextBytes: 256 }), /context exceeds 256 bytes/);
  await assert.rejects(() => proposeAgentWorkflowWithProvider(provider, graph, 'delegate', { unsafe: 1n }), /context must be JSON-safe/i);
  assert.equal(calls, 1);
});

test('workflow provider rejects invalid task semantics and DAG dependencies before execution', async () => {
  const graph = createGraph('Invalid workflow');
  const providerFor = (tasks) => createWorkflowPlannerProvider({ id: 'invalid', proposeWorkflow: async () => ({ summary: 'Invalid', operations: [], tasks }) });
  await assert.rejects(() => proposeAgentWorkflowWithProvider(providerFor([{ id: 'x', kind: 'unknown', payload: {} }]), graph, 'delegate'), /Unsupported Agent workflow task kind/);
  await assert.rejects(() => proposeAgentWorkflowWithProvider(providerFor([{ id: 'x', kind: 'generate-media', dependsOn: ['missing'], payload: { operation: 'generate-image' } }]), graph, 'delegate'), /Unknown pipeline dependency/);
  await assert.rejects(() => proposeAgentWorkflowWithProvider(providerFor([{ id: 'x', kind: 'generate-media', payload: { operation: 'plan' } }]), graph, 'delegate'), /Unsupported Agent generate-media operation/);
});

test('workflow planner result enforces task and canonical byte bounds', () => {
  assert.throws(() => assertWorkflowPlannerResult({ summary: 'Too many', operations: [], tasks: Array.from({ length: MAX_AGENT_WORKFLOW_TASKS + 1 }, (_, index) => ({ id: String(index) })) }), /exceeds 256 tasks/);
  assert.throws(() => assertWorkflowPlannerResult({ summary: 'Unsafe', operations: [], tasks: [], metadata: { value: 1n } }), /JSON|serialize|BigInt/i);
  assert.throws(() => assertWorkflowPlannerResult({ summary: 'Large', operations: [], tasks: [{ id: 'x', payload: { text: 'x'.repeat(2048) } }] }, { maxResultBytes: 512 }), /exceeds 512 bytes/);
});

test('model-router workflow provider uses bounded privacy-safe semantic context and records routing provenance', async () => {
  let graph = createGraph('Privacy workflow');
  const visibleOps = createCreativeObjectOperations(graph, { name: 'Maya Visible', objectType: 'person' });
  graph = applyOperations(graph, visibleOps);
  const hiddenOps = createCreativeObjectOperations(graph, { name: 'Secret Person', objectType: 'person', semantics: { secret: 'never send' }, permissions: { modelAccess: 'none' } });
  graph = applyOperations(graph, hiddenOps);
  const visibleId = visibleOps[0].node.id;
  const hiddenId = hiddenOps[0].node.id;
  let captured = null;
  const router = new ModelRouter().register({
    id: 'workflow-backend',
    operations: ['plan-workflow'],
    location: 'local',
    invoke: async (operation, input, options) => {
      captured = { operation, input, context: options.context };
      return {
        summary: 'Enrich Maya',
        operations: [],
        tasks: [{ id: 'enrich', kind: 'semantic-enrichment', payload: { sourceNodeIds: [visibleId] } }],
      };
    },
  });
  const provider = createModelRouterWorkflowProvider({ router, contextMode: 'semantic', semanticContextOptions: { limit: 4, maxNodes: 8 } });
  const workflow = await proposeAgentWorkflowWithProvider(provider, graph, 'enrich Maya');
  assert.equal(captured.operation, 'plan-workflow');
  assert.ok(captured.input.graph.nodes[visibleId]);
  assert.equal(captured.input.graph.nodes[hiddenId], undefined);
  assert.equal(JSON.stringify(captured.input).includes('never send'), false);
  assert.equal(captured.context.contextMode, 'semantic');
  assert.equal(workflow.plan.metadata.workflowPlanner.routing.backendId, 'workflow-backend');
  assert.deepEqual(workflow.plan.metadata.workflowPlanner.routing.semanticMatchIds, [visibleId]);
});

test('model-router workflow planning honors abort before backend invocation', async () => {
  const graph = createGraph('Abort workflow');
  let calls = 0;
  const router = new ModelRouter().register({ id: 'workflow-backend', operations: ['plan-workflow'], invoke: async () => { calls += 1; return { summary: 'x', operations: [], tasks: [] }; } });
  const provider = createModelRouterWorkflowProvider({ router });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => proposeAgentWorkflowWithProvider(provider, graph, 'delegate', {}, { signal: controller.signal }), (error) => error?.name === 'AbortError');
  assert.equal(calls, 0);
});


test('workflow planner result normalization rejects accessors without executing them', () => {
  let getterCalls = 0;
  const result = { summary: 'safe', operations: [] };
  Object.defineProperty(result, 'tasks', { enumerable: true, get() { getterCalls += 1; return []; } });
  assert.throws(() => assertWorkflowPlannerResult(result), /Workflow planner result must be JSON-safe/i);
  assert.equal(getterCalls, 0);
});


test('workflow provider descriptors reject accessors without executing them', async () => {
  let getterCalls = 0;
  const provider = { proposeWorkflow: async () => ({ summary: 'noop', operations: [], tasks: [] }) };
  Object.defineProperty(provider, 'id', { enumerable: true, get() { getterCalls += 1; return 'unsafe'; } });
  assert.throws(() => createWorkflowPlannerProvider(provider), /enumerable data fields only/);
  assert.equal(getterCalls, 0);
  await assert.rejects(() => proposeAgentWorkflowWithProvider(provider, createGraph('Raw workflow provider'), 'delegate'), /enumerable data fields only/);
  assert.equal(getterCalls, 0);
});


test('model workflow planner factory rejects accessor-bearing config before routing', () => {
  let routerGetterCalls = 0;
  const config = {};
  Object.defineProperty(config, 'router', { enumerable: true, get() { routerGetterCalls += 1; return new ModelRouter(); } });
  assert.throws(() => createModelRouterWorkflowProvider(config), /config must contain enumerable data fields only/);
  assert.equal(routerGetterCalls, 0);
  assert.throws(() => createModelRouterWorkflowProvider({ router: new ModelRouter(), semanticContextOptions: { neighborDepth: '1' } }), /neighborDepth must be an integer/);
});


test('workflow planner invocation options reject accessors unknown fields and coercive byte limits before provider execution', async () => {
  const graph = createGraph('Strict workflow invocation');
  let calls = 0;
  const provider = createWorkflowPlannerProvider({ id: 'strict-workflow', proposeWorkflow: async () => { calls += 1; return { summary: 'noop', operations: [], tasks: [] }; } });
  let getterCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'maxContextBytes', { enumerable: true, get() { getterCalls += 1; return 256; } });
  await assert.rejects(() => proposeAgentWorkflowWithProvider(provider, graph, 'delegate', {}, accessor), /config must contain enumerable data fields only/);
  assert.equal(getterCalls, 0);
  assert.equal(calls, 0);
  await assert.rejects(() => proposeAgentWorkflowWithProvider(provider, graph, 'delegate', {}, { maxContextBytes: '256' }), /maxContextBytes must be an integer/);
  await assert.rejects(() => proposeAgentWorkflowWithProvider(provider, graph, 'delegate', {}, { maxContextBytes: MAX_PLANNER_CONTEXT_BYTES + 1 }), /maxContextBytes must be an integer/);
  await assert.rejects(() => proposeAgentWorkflowWithProvider(provider, graph, 'delegate', {}, { maxResultBytes: MAX_AGENT_WORKFLOW_BYTES + 1 }), /maxResultBytes must be an integer/);
  await assert.rejects(() => proposeAgentWorkflowWithProvider(provider, graph, 'delegate', {}, { hidden: true }), /Unsupported workflow planner invocation config field: hidden/);
  assert.equal(calls, 0);
});


test('workflow planner invocation forwards AbortSignal unchanged through strict option normalization', async () => {
  const graph = createGraph('Workflow signal');
  const controller = new AbortController();
  let seenSignal = null;
  const provider = createWorkflowPlannerProvider({ id: 'signal-forward', proposeWorkflow: async ({ signal }) => { seenSignal = signal; return { summary: 'noop', operations: [], tasks: [] }; } });
  await proposeAgentWorkflowWithProvider(provider, graph, 'delegate', {}, { signal: controller.signal });
  assert.equal(seenSignal, controller.signal);
});

test('workflow result limit options are strict bounded data before result validation', () => {
  let getterCalls = 0;
  const options = {};
  Object.defineProperty(options, 'maxResultBytes', { enumerable: true, get() { getterCalls += 1; return 256; } });
  assert.throws(() => assertWorkflowPlannerResult({ summary: 'noop', operations: [], tasks: [] }, options), /config must contain enumerable data fields only/);
  assert.equal(getterCalls, 0);
  assert.throws(() => assertWorkflowPlannerResult({ summary: 'noop', operations: [], tasks: [] }, { maxResultBytes: '256' }), /maxResultBytes must be an integer/);
  assert.throws(() => assertWorkflowPlannerResult({ summary: 'noop', operations: [], tasks: [] }, { maxResultBytes: MAX_AGENT_WORKFLOW_BYTES + 1 }), /maxResultBytes must be an integer/);
});
