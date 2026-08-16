import assert from 'node:assert/strict';
import test from 'node:test';
import { createGraph, createNode } from '../src/graph.js';
import { createAgentPlan, applyAgentPlan } from '../src/agent-plan.js';
import { createAgentPlanReview } from '../src/agent-review.js';
import {
  agentWorkflowProgress,
  assertAgentWorkflow,
  completeAgentWorkflowTask,
  createAgentWorkflow,
  failAgentWorkflowTask,
  materializeAgentWorkflowPlan,
  runnableAgentWorkflowTasks,
  startAgentWorkflowTask,
} from '../src/agent-workflow.js';

test('Agent workflow reuses DAG dependencies for staged side effects', () => {
  const graph = createGraph('Film');
  const plan = createAgentPlan(graph, { intent: 'analyze then restyle', providerId: 'mock', operations: [] });
  let workflow = createAgentWorkflow(plan, [
    { id: 'analyze', kind: 'semantic-enrichment', payload: { sourceNodeIds: [] } },
    { id: 'generate', kind: 'generate-media', dependsOn: ['analyze'], payload: { operation: 'generate-image', sourceNodeIds: [], creativeObjectIds: [], intent: 'restyle' } },
  ]);
  assert.deepEqual(runnableAgentWorkflowTasks(workflow).map((task) => task.id), ['analyze']);
  workflow = startAgentWorkflowTask(workflow, 'analyze');
  workflow = completeAgentWorkflowTask(workflow, 'analyze');
  assert.deepEqual(runnableAgentWorkflowTasks(workflow).map((task) => task.id), ['generate']);
  workflow = completeAgentWorkflowTask(workflow, 'generate');
  assert.equal(agentWorkflowProgress(workflow).done, true);
});

test('completed Agent workflow materializes task operations into a new reviewable proposal revision', () => {
  const graph = createGraph('Film');
  const plan = createAgentPlan(graph, { intent: 'generate an image', summary: 'Generate image', providerId: 'mock', operations: [] });
  let workflow = createAgentWorkflow(plan, [{ id: 'generate', kind: 'generate-media', payload: { operation: 'generate-image' } }]);
  workflow = completeAgentWorkflowTask(workflow, 'generate');
  const asset = createNode({ id: 'generated', kind: 'asset', name: 'Generated.png', props: { mediaKind: 'image', mimeType: 'image/png' } });
  const materialized = materializeAgentWorkflowPlan(graph, workflow, { generate: { operations: [{ type: 'node.add', node: asset }], summary: 'Created Generated.png' } });
  assert.equal(materialized.revision, plan.revision + 1);
  assert.equal(materialized.metadata.workflow.id, workflow.id);
  assert.equal(materialized.metadata.workflow.tasks[0].operationCount, 1);
  assert.equal(createAgentPlanReview(graph, materialized).operations[0].summary, 'Add asset Generated.png');
  assert.ok(applyAgentPlan(graph, materialized).nodes.generated);
});

test('Agent workflow refuses materialization before required tasks are complete', () => {
  const graph = createGraph('Film');
  const plan = createAgentPlan(graph, { intent: 'generate', providerId: 'mock', operations: [] });
  const workflow = createAgentWorkflow(plan, [{ id: 'generate', kind: 'generate-media', payload: { operation: 'generate-image' } }]);
  assert.throws(() => materializeAgentWorkflowPlan(graph, workflow, { generate: { operations: [] } }), /not complete/);
});

test('Agent workflow failures block final materialization', () => {
  const graph = createGraph('Film');
  const plan = createAgentPlan(graph, { intent: 'generate', providerId: 'mock', operations: [] });
  let workflow = createAgentWorkflow(plan, [{ id: 'generate', kind: 'generate-media', payload: { operation: 'generate-image' } }]);
  workflow = failAgentWorkflowTask(workflow, 'generate', new Error('provider outage'));
  assert.equal(agentWorkflowProgress(workflow).blocked, true);
  assert.throws(() => materializeAgentWorkflowPlan(graph, workflow, { generate: { operations: [] } }), /not complete/);
});

test('optional Agent workflow tasks must reach a terminal state and may be skipped after failure', () => {
  const graph = createGraph('Film');
  const plan = createAgentPlan(graph, { intent: 'best effort', providerId: 'mock', operations: [] });
  let workflow = createAgentWorkflow(plan, [
    { id: 'required', kind: 'semantic-enrichment', payload: {} },
    { id: 'optional', kind: 'generate-media', optional: true, payload: { operation: 'generate-image' } },
  ]);
  workflow = completeAgentWorkflowTask(workflow, 'required');
  assert.equal(agentWorkflowProgress(workflow).done, false);
  workflow = failAgentWorkflowTask(workflow, 'optional', new Error('optional model unavailable'));
  assert.equal(agentWorkflowProgress(workflow).done, true);
  assert.equal(agentWorkflowProgress(workflow).blocked, false);
  const materialized = materializeAgentWorkflowPlan(graph, workflow, { required: { operations: [] } });
  assert.equal(materialized.metadata.workflow.tasks.find((task) => task.id === 'optional').skipped, true);
});

test('Agent workflow validates task kinds, payloads and dependencies before execution', () => {
  const graph = createGraph('Film');
  const plan = createAgentPlan(graph, { intent: 'work', providerId: 'mock', operations: [] });
  assert.throws(() => createAgentWorkflow(plan, [{ id: 'x', kind: 'unknown', payload: {} }]), /Unsupported Agent workflow task kind/);
  assert.throws(() => createAgentWorkflow(plan, [{ id: 'x', kind: 'generate-media', payload: { operation: 'plan' } }]), /Unsupported Agent generate-media operation/);
  assert.throws(() => createAgentWorkflow(plan, [{ id: 'x', kind: 'generate-media', dependsOn: ['missing'], payload: { operation: 'generate-image' } }]), /Unknown pipeline dependency/);
});

test('Agent workflow result operations are preflighted as part of the revised plan', () => {
  const graph = createGraph('Film');
  const plan = createAgentPlan(graph, { intent: 'bad generation', providerId: 'mock', operations: [] });
  let workflow = createAgentWorkflow(plan, [{ id: 'generate', kind: 'generate-media', payload: { operation: 'generate-image' } }]);
  workflow = completeAgentWorkflowTask(workflow, 'generate');
  assert.throws(() => materializeAgentWorkflowPlan(graph, workflow, { generate: { operations: [{ type: 'node.update', nodeId: 'missing', patch: { name: 'bad' } }] } }), /Unknown node/);
});

test('Agent workflow validation returns inert data and never executes accessors', () => {
  const graph = createGraph('Film');
  const plan = createAgentPlan(graph, { intent: 'analyze', providerId: 'mock', operations: [] });
  const workflow = createAgentWorkflow(plan, [{ id: 'analyze', kind: 'semantic-enrichment', payload: { sourceNodeIds: ['source'] } }]);
  const clean = assertAgentWorkflow(workflow);
  assert.notEqual(clean, workflow);
  assert.notEqual(clean.tasks, workflow.tasks);
  workflow.tasks[0].payload.sourceNodeIds[0] = 'mutated';
  assert.equal(clean.tasks[0].payload.sourceNodeIds[0], 'source');
  let getterCalls = 0;
  const forged = {};
  Object.defineProperty(forged, 'schema', { enumerable: true, get() { getterCalls += 1; return 'media.agent-workflow.v1'; } });
  assert.throws(() => assertAgentWorkflow(forged), /Agent workflow must be JSON-safe/);
  assert.equal(getterCalls, 0);
});

test('Agent workflow creation rejects coercive ids, malformed optional flags and accessor options', () => {
  const graph = createGraph('Film');
  const plan = createAgentPlan(graph, { intent: 'generate', providerId: 'mock', operations: [] });
  let coercions = 0;
  const forgedId = { toString() { coercions += 1; return 'source'; } };
  assert.throws(() => createAgentWorkflow(plan, [{ id: 'generate', kind: 'generate-media', payload: { operation: 'generate-image', sourceNodeIds: [forgedId] } }]), /JSON-safe|sourceNodeIds/);
  assert.equal(coercions, 0);
  assert.throws(() => createAgentWorkflow(plan, [{ id: 'generate', kind: 'generate-media', optional: 'yes', payload: { operation: 'generate-image' } }]), /optional must be a boolean/);
  let getterCalls = 0;
  const options = {};
  Object.defineProperty(options, 'id', { enumerable: true, get() { getterCalls += 1; return 'unsafe'; } });
  assert.throws(() => createAgentWorkflow(plan, [], options), /options must contain enumerable data fields only/);
  assert.equal(getterCalls, 0);
});

test('Agent workflow failure and materialization do not execute injected error or result accessors', () => {
  const graph = createGraph('Film');
  const plan = createAgentPlan(graph, { intent: 'work', providerId: 'mock', operations: [] });
  let workflow = createAgentWorkflow(plan, [{ id: 'analyze', kind: 'semantic-enrichment', payload: {} }]);
  let messageGetterCalls = 0;
  let toStringCalls = 0;
  const error = { toString() { toStringCalls += 1; return 'private'; } };
  Object.defineProperty(error, 'message', { enumerable: true, get() { messageGetterCalls += 1; return 'secret'; } });
  const failed = failAgentWorkflowTask(workflow, 'analyze', error);
  assert.equal(failed.tasks[0].error, 'Agent workflow task failed');
  assert.equal(messageGetterCalls, 0);
  assert.equal(toStringCalls, 0);

  workflow = completeAgentWorkflowTask(workflow, 'analyze');
  let resultGetterCalls = 0;
  const results = {};
  Object.defineProperty(results, 'analyze', { enumerable: true, get() { resultGetterCalls += 1; return { operations: [] }; } });
  assert.throws(() => materializeAgentWorkflowPlan(graph, workflow, results), /taskResults must be JSON-safe/);
  assert.equal(resultGetterCalls, 0);
  assert.throws(() => materializeAgentWorkflowPlan(graph, workflow, { analyze: { operations: [], summary: {} } }), /summary must be a string/);
});

test('failed upstream tasks cascade failure to required dependents instead of deadlocking the workflow', () => {
  const graph = createGraph('Film');
  const plan = createAgentPlan(graph, { intent: 'analyze then generate', providerId: 'mock', operations: [] });
  let workflow = createAgentWorkflow(plan, [
    { id: 'optional-analysis', kind: 'semantic-enrichment', optional: true, payload: {} },
    { id: 'required-generation', kind: 'generate-media', dependsOn: ['optional-analysis'], payload: { operation: 'generate-image' } },
  ]);
  workflow = failAgentWorkflowTask(workflow, 'optional-analysis', new Error('analysis unavailable'));
  const dependent = workflow.tasks.find((task) => task.id === 'required-generation');
  assert.equal(dependent.status, 'failed');
  assert.equal(dependent.error, 'dependency-failed');
  assert.equal(agentWorkflowProgress(workflow).blocked, true);
  assert.deepEqual(runnableAgentWorkflowTasks(workflow), []);
});
