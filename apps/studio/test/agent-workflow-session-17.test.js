import assert from 'node:assert/strict';
import test from 'node:test';
import { createGraph } from '../../../packages/core/src/graph.js';
import { createAgentPlan } from '../../../packages/core/src/agent-plan.js';
import { createAgentWorkflow } from '../../../packages/core/src/agent-workflow.js';
import { ModelRouter } from '../../../packages/core/src/model-router.js';
import { AgentWorkflowExecutionError, AgentWorkflowSession } from '../agent-workflow-session.js';

test('Agent workflow session lets semantic analysis feed a later generation task by semantic id', async () => {
  const graph = createGraph('Film');
  const router = new ModelRouter()
    .register({ id: 'vision', operations: ['analyze-media'], priority: 10, invoke: async () => ({ objects: [{ name: 'Maya jacket', objectType: 'wardrobe', semanticId: 'wardrobe:jacket' }] }) })
    .register({ id: 'image', operations: ['generate-image'], invoke: async (_operation, input) => {
      assert.equal(Object.values(input.sourceGraph.nodes).some((node) => node.props?.semanticId === 'wardrobe:jacket'), true);
      return { artifact: { name: 'Blue jacket.png', mimeType: 'image/png' }, payload: new Uint8Array([1, 2]) };
    } });
  const plan = createAgentPlan(graph, { intent: 'find the jacket and make it blue', providerId: 'mock', operations: [] });
  const workflow = createAgentWorkflow(plan, [
    { id: 'analyze', kind: 'semantic-enrichment', payload: {} },
    { id: 'generate', kind: 'generate-media', dependsOn: ['analyze'], payload: { operation: 'generate-image', creativeObjectSemanticIds: ['wardrobe:jacket'] } },
  ]);
  const session = new AgentWorkflowSession({ router, getGraph: () => graph, assetUri: (id) => `local://${id}` });
  const result = await session.execute(workflow);
  assert.equal(result.plan.revision, 2);
  assert.equal(result.persistContext.assetWrites.length, 1);
  assert.ok(Object.values(result.previewGraph.nodes).some((node) => node.kind === 'asset' && node.name === 'Blue jacket.png'));
  assert.ok(Object.values(result.previewGraph.nodes).some((node) => node.kind === 'object' && node.props.semanticId === 'wardrobe:jacket'));
});

test('Agent workflow session rejects accessor dependencies and unsafe execution options before model work', async () => {
  const graph = createGraph('Film');
  let getterCalls = 0;
  const forgedRouter = {};
  Object.defineProperty(forgedRouter, 'execute', { get() { getterCalls += 1; return () => {}; } });
  assert.throws(() => new AgentWorkflowSession({ router: forgedRouter, getGraph: () => graph }), /execute must be a data method/);
  assert.equal(getterCalls, 0);
  const constructorOptions = { getGraph: () => graph };
  Object.defineProperty(constructorOptions, 'router', { enumerable: true, get() { getterCalls += 1; return forgedRouter; } });
  assert.throws(() => new AgentWorkflowSession(constructorOptions), /session options must contain enumerable data fields only/);
  assert.equal(getterCalls, 0);

  let invokes = 0;
  const router = new ModelRouter().register({ id: 'vision', operations: ['analyze-media'], invoke: async () => { invokes += 1; return { objects: [] }; } });
  const plan = createAgentPlan(graph, { intent: 'analyze', providerId: 'mock', operations: [] });
  const workflow = createAgentWorkflow(plan, [{ id: 'analyze', kind: 'semantic-enrichment', payload: {} }]);
  const session = new AgentWorkflowSession({ router, getGraph: () => graph });
  const executionOptions = {};
  Object.defineProperty(executionOptions, 'inputs', { enumerable: true, get() { getterCalls += 1; return {}; } });
  await assert.rejects(() => session.execute(workflow, executionOptions), /execution options must contain enumerable data fields only/);
  const forgedSignal = {};
  Object.defineProperty(forgedSignal, 'aborted', { get() { getterCalls += 1; return false; } });
  await assert.rejects(() => session.execute(workflow, { signal: forgedSignal }), /AbortSignal/);
  await assert.rejects(() => session.execute(workflow, { inputs: { missing: {} } }), /Unknown Agent workflow input task/);
  assert.equal(getterCalls, 0);
  assert.equal(invokes, 0);
});

test('Agent workflow session snapshots task inputs before asynchronous model work', async () => {
  const graph = createGraph('Film');
  let seenNote = null;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const router = new ModelRouter().register({ id: 'vision', operations: ['analyze-media'], invoke: async (_operation, input) => { await gate; seenNote = input.input.note; return { objects: [] }; } });
  const plan = createAgentPlan(graph, { intent: 'analyze', providerId: 'mock', operations: [] });
  const workflow = createAgentWorkflow(plan, [{ id: 'analyze', kind: 'semantic-enrichment', payload: {} }]);
  const inputs = { analyze: { note: 'original' } };
  const pending = new AgentWorkflowSession({ router, getGraph: () => graph }).execute(workflow, { inputs });
  inputs.analyze.note = 'mutated';
  release();
  await pending;
  assert.equal(seenNote, 'original');
});

test('Agent workflow session treats prototype-named task inputs as explicit own data only', async () => {
  const graph = createGraph('Film');
  let seenInput = null;
  const router = new ModelRouter().register({ id: 'vision', operations: ['analyze-media'], invoke: async (_operation, input) => { seenInput = input.input; return { objects: [] }; } });
  const plan = createAgentPlan(graph, { intent: 'analyze', providerId: 'mock', operations: [] });
  const workflow = createAgentWorkflow(plan, [{ id: '__proto__', kind: 'semantic-enrichment', payload: {} }]);
  const result = await new AgentWorkflowSession({ router, getGraph: () => graph }).execute(workflow);
  assert.deepEqual(seenInput, {});
  assert.equal(result.plan.metadata.workflow.tasks[0].id, '__proto__');
});

test('Agent workflow execution errors do not execute hostile message or string coercion', () => {
  let getterCalls = 0;
  let coercions = 0;
  const error = { toString() { coercions += 1; return 'secret'; } };
  Object.defineProperty(error, 'message', { get() { getterCalls += 1; return 'private'; } });
  const wrapped = new AgentWorkflowExecutionError('task', error, { safe: true });
  assert.match(wrapped.message, /Agent workflow task failed/);
  assert.equal(getterCalls, 0);
  assert.equal(coercions, 0);
});

test('Agent workflow session keeps generated asset bytes pending for final proposal approval', async () => {
  const graph = createGraph('Film');
  const bytes = new Uint8Array([5, 6, 7]);
  const router = new ModelRouter().register({ id: 'image', operations: ['generate-image'], invoke: async () => ({ artifact: { name: 'Frame.png', mimeType: 'image/png' }, payload: bytes }) });
  const plan = createAgentPlan(graph, { intent: 'generate frame', providerId: 'mock', operations: [] });
  const workflow = createAgentWorkflow(plan, [{ id: 'generate', kind: 'generate-media', payload: { operation: 'generate-image' } }]);
  const result = await new AgentWorkflowSession({ router, getGraph: () => graph }).execute(workflow);
  assert.equal(Object.values(graph.nodes).some((node) => node.kind === 'asset'), false);
  assert.equal(result.persistContext.assetWrites[0].blob.size, 3);
  assert.equal(result.plan.metadata.workflow.tasks[0].operationCount >= 2, true);
});

test('optional workflow model failure is skipped while required work can still materialize', async () => {
  const graph = createGraph('Film');
  const router = new ModelRouter()
    .register({ id: 'vision', operations: ['analyze-media'], invoke: async () => ({ objects: [] }) })
    .register({ id: 'image', operations: ['generate-image'], invoke: async () => { throw new Error('image service down'); } });
  const plan = createAgentPlan(graph, { intent: 'analyze, maybe generate', providerId: 'mock', operations: [] });
  const workflow = createAgentWorkflow(plan, [
    { id: 'analyze', kind: 'semantic-enrichment', payload: {} },
    { id: 'generate', kind: 'generate-media', optional: true, payload: { operation: 'generate-image' } },
  ]);
  const result = await new AgentWorkflowSession({ router, getGraph: () => graph }).execute(workflow);
  assert.equal(result.workflow.tasks.find((task) => task.id === 'generate').status, 'failed');
  assert.equal(result.plan.metadata.workflow.tasks.find((task) => task.id === 'generate').skipped, true);
});

test('required workflow model failure exposes task id and failed workflow state', async () => {
  const graph = createGraph('Film');
  const router = new ModelRouter().register({ id: 'image', operations: ['generate-image'], invoke: async () => { throw new Error('down'); } });
  const plan = createAgentPlan(graph, { intent: 'generate', providerId: 'mock', operations: [] });
  const workflow = createAgentWorkflow(plan, [{ id: 'generate', kind: 'generate-media', payload: { operation: 'generate-image' } }]);
  await assert.rejects(() => new AgentWorkflowSession({ router, getGraph: () => graph }).execute(workflow), (error) => error instanceof AgentWorkflowExecutionError && error.taskId === 'generate' && error.workflow.tasks[0].status === 'failed');
});
