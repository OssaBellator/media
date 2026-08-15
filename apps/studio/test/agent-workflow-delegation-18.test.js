import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAgentPlan } from '../../../packages/core/src/agent-plan.js';
import { createAgentWorkflow } from '../../../packages/core/src/agent-workflow.js';
import { createGraph } from '../../../packages/core/src/graph.js';
import { ModelRouter } from '../../../packages/core/src/model-router.js';
import {
  assertStudioWorkflowIntent,
  inspectStudioWorkflowExecutionCapabilities,
  MAX_STUDIO_WORKFLOW_INTENT_CHARS,
  studioWorkflowDelegationAvailable,
} from '../agent-review-bridge.js';

test('Studio workflow intent is normalized and bounded before routing', () => {
  assert.equal(assertStudioWorkflowIntent('  delegate this  '), 'delegate this');
  assert.throws(() => assertStudioWorkflowIntent('   '), /non-empty/);
  assert.throws(() => assertStudioWorkflowIntent('x'.repeat(MAX_STUDIO_WORKFLOW_INTENT_CHARS + 1)), /exceeds 16384 characters/);
});

test('Studio workflow delegation is available only with an explicit plan-workflow backend', () => {
  assert.equal(studioWorkflowDelegationAvailable(null), false);
  assert.equal(studioWorkflowDelegationAvailable({ execute() {}, list() { return []; } }), false);
  assert.equal(studioWorkflowDelegationAvailable({ execute() {}, list(operation) { return operation === 'plan-workflow' ? [{ id: 'planner' }] : []; } }), true);
  assert.equal(studioWorkflowDelegationAvailable({ execute() {}, list() { throw new Error('offline'); } }), false);
});

test('Studio preflights every required workflow model operation before execution', () => {
  const graph = createGraph('Delegation capability');
  const plan = createAgentPlan(graph, { intent: 'enrich then generate', providerId: 'workflow-test', operations: [] });
  const workflow = createAgentWorkflow(plan, [
    { id: 'enrich', kind: 'semantic-enrichment', payload: { sourceNodeIds: [] } },
    { id: 'generate', kind: 'generate-media', dependsOn: ['enrich'], payload: { operation: 'generate-image' } },
    { id: 'optional-audio', kind: 'generate-media', optional: true, payload: { operation: 'generate-audio' } },
  ]);
  const router = {
    list(operation) {
      if (operation === 'analyze-media') return [{ id: 'analysis' }];
      return [];
    },
  };
  assert.deepEqual(inspectStudioWorkflowExecutionCapabilities(workflow, router), {
    requiredOperations: ['analyze-media', 'generate-image'],
    optionalOperations: ['generate-audio'],
    missingRequiredOperations: ['generate-image'],
    missingOptionalOperations: ['generate-audio'],
  });
});

test('Studio workflow capability preflight honors task routing policy', () => {
  const graph = createGraph('Policy workflow');
  const plan = createAgentPlan(graph, { intent: 'local image edit', providerId: 'workflow-test', operations: [] });
  const workflow = createAgentWorkflow(plan, [
    { id: 'local-image', kind: 'generate-media', payload: { operation: 'generate-image', policy: { dataPolicy: 'local' } } },
  ]);
  const router = new ModelRouter().register({ id: 'remote-image', operations: ['generate-image'], location: 'remote', invoke: async () => ({}) });
  const capability = inspectStudioWorkflowExecutionCapabilities(workflow, router);
  assert.deepEqual(capability.requiredOperations, ['generate-image']);
  assert.deepEqual(capability.missingRequiredOperations, ['generate-image']);
});

test('optional unavailable model operations do not block required workflow execution capability', () => {
  const graph = createGraph('Optional workflow');
  const plan = createAgentPlan(graph, { intent: 'analyze with optional image', providerId: 'workflow-test', operations: [] });
  const workflow = createAgentWorkflow(plan, [
    { id: 'enrich', kind: 'semantic-enrichment', payload: { sourceNodeIds: [] } },
    { id: 'optional-image', kind: 'generate-media', optional: true, payload: { operation: 'generate-image' } },
  ]);
  const router = { list(operation) { return operation === 'analyze-media' ? [{ id: 'analysis' }] : []; } };
  const capability = inspectStudioWorkflowExecutionCapabilities(workflow, router);
  assert.deepEqual(capability.missingRequiredOperations, []);
  assert.deepEqual(capability.missingOptionalOperations, ['generate-image']);
});

test('Agent workspace exposes distinct Propose and capability-gated Delegate workflow actions', async () => {
  const view = await readFile(new URL('../view.js', import.meta.url), 'utf8');
  const bridge = await readFile(new URL('../agent-review-bridge.js', import.meta.url), 'utf8');
  const runtime = await readFile(new URL('../studio-runtime.js', import.meta.url), 'utf8');
  assert.match(view, /id="agent-input" rows="3" maxlength="16384"/);
  assert.match(view, /data-agent-delegate disabled>Delegate workflow/);
  assert.match(view, /class="primary-button" type="submit">Propose/);
  assert.match(bridge, /createModelRouterWorkflowProvider\(\{ router, contextMode: 'semantic' \}\)/);
  assert.match(bridge, /proposeAgentWorkflowWithProvider\(provider, record\.historySession\.history\.present, intent\)/);
  assert.match(bridge, /if \(delegated\)[\s\S]*delegateIntent\(root, editedIntent \|\| previousIntent\)/);
  assert.match(runtime, /registerStudioAgentReviewSession\(historyJournal\)/);
  assert.doesNotMatch(runtime, /registerStudioModelRouterProvider/);
});
