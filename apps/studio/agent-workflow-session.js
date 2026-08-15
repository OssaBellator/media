import { applyOperations } from '../../packages/core/src/operations.js';
import { assertAgentPlanMatchesGraph } from '../../packages/core/src/agent-plan.js';
import {
  agentWorkflowProgress,
  assertAgentWorkflow,
  completeAgentWorkflowTask,
  failAgentWorkflowTask,
  materializeAgentWorkflowPlan,
  runnableAgentWorkflowTasks,
  startAgentWorkflowTask,
} from '../../packages/core/src/agent-workflow.js';
import { findCreativeObjects } from '../../packages/core/src/creative-object.js';
import { runGeneratedMediaModel } from '../../packages/core/src/generation-runner.js';
import { runSemanticEnrichmentModel } from '../../packages/core/src/semantic-enrichment.js';
import { prepareGeneratedMediaPersistence } from './generated-media-commit-session.js';

function requireFunction(value, label) {
  if (typeof value !== 'function') throw new Error(`${label} must be a function`);
  return value;
}
function resolveSemanticIds(graph, semanticIds = [], label) {
  const result = [];
  for (const semanticId of semanticIds ?? []) {
    const matches = findCreativeObjects(graph, { semanticId: String(semanticId) });
    if (matches.length !== 1) throw new Error(`${label} ${semanticId} resolved to ${matches.length} objects`);
    result.push(matches[0].id);
  }
  return result;
}

export class AgentWorkflowExecutionError extends Error {
  constructor(taskId, error, workflow) {
    super(`Agent workflow task ${taskId} failed: ${error?.message ?? error}`);
    this.name = 'AgentWorkflowExecutionError';
    this.code = 'AGENT_WORKFLOW_EXECUTION_FAILED';
    this.taskId = taskId;
    this.workflow = workflow;
    this.cause = error;
  }
}

export class AgentWorkflowSession {
  constructor({ router, getGraph, assetUri = (assetId) => `media://asset/${assetId}` } = {}) {
    if (!router || typeof router.execute !== 'function') throw new Error('Agent workflow session requires a model router');
    this.router = router;
    this.getGraph = requireFunction(getGraph, 'Agent workflow getGraph');
    this.assetUri = requireFunction(assetUri, 'Agent workflow assetUri');
  }

  async execute(workflow, { inputs = {}, signal } = {}) {
    assertAgentWorkflow(workflow);
    const baseGraph = this.getGraph();
    assertAgentPlanMatchesGraph(baseGraph, workflow.plan);
    let state = workflow;
    let previewGraph = baseGraph;
    const taskResults = {};
    const assetWrites = [];

    while (!agentWorkflowProgress(state).done && !agentWorkflowProgress(state).blocked) {
      const runnable = runnableAgentWorkflowTasks(state).slice().sort((a, b) => a.id.localeCompare(b.id));
      if (!runnable.length) throw new Error('Agent workflow has no runnable tasks but is not complete');
      const task = runnable[0];
      state = startAgentWorkflowTask(state, task.id);
      try {
        let operations;
        let summary;
        if (task.kind === 'semantic-enrichment') {
          const result = await runSemanticEnrichmentModel(this.router, previewGraph, { ...task.payload, modelInput: inputs[task.id] ?? {}, signal });
          operations = result.operations;
          summary = `Semantic enrichment via ${result.backendId}`;
        } else if (task.kind === 'generate-media') {
          const sourceNodeIds = [...new Set([...(task.payload.sourceNodeIds ?? []), ...resolveSemanticIds(previewGraph, task.payload.sourceSemanticIds, 'Generation source semantic id')])];
          const creativeObjectIds = [...new Set([...(task.payload.creativeObjectIds ?? []), ...resolveSemanticIds(previewGraph, task.payload.creativeObjectSemanticIds, 'Generation creative object semantic id')])];
          const result = await runGeneratedMediaModel(this.router, previewGraph, { ...task.payload, sourceNodeIds, creativeObjectIds, modelInput: inputs[task.id] ?? {}, parentPlanId: workflow.plan.id, signal });
          const prepared = prepareGeneratedMediaPersistence(result, { assetUri: this.assetUri });
          operations = prepared.operations;
          assetWrites.push(...prepared.persistContext.assetWrites);
          summary = `Generated ${prepared.asset.name} via ${result.backendId}`;
        } else throw new Error(`Unsupported Agent workflow task kind: ${task.kind}`);
        previewGraph = applyOperations(previewGraph, operations);
        taskResults[task.id] = { operations, summary };
        state = completeAgentWorkflowTask(state, task.id);
      } catch (error) {
        state = failAgentWorkflowTask(state, task.id, error);
        if (!task.optional) throw new AgentWorkflowExecutionError(task.id, error, state);
      }
    }
    if (agentWorkflowProgress(state).blocked) throw new AgentWorkflowExecutionError('dependency', new Error('Agent workflow is blocked by a failed required task'), state);
    const plan = materializeAgentWorkflowPlan(baseGraph, state, taskResults);
    return { workflow: state, plan, taskResults, persistContext: { assetWrites }, previewGraph };
  }
}
