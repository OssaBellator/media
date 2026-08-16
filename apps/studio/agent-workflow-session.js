import { applyOperations } from '../../packages/core/src/operations.js';
import { assertAgentPlanMatchesGraph } from '../../packages/core/src/agent-plan.js';
import { DEFAULT_MODEL_INPUT_BYTES, normalizeBoundedModelInput } from '../../packages/core/src/model-input.js';
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

const SESSION_OPTION_KEYS = new Set(['router', 'getGraph', 'assetUri']);
const EXECUTION_OPTION_KEYS = new Set(['inputs', 'signal']);
const MAX_WORKFLOW_ERROR_CHARS = 1024;

function requireFunction(value, label) {
  if (typeof value !== 'function') throw new Error(`${label} must be a function`);
  return value;
}
function dataOptions(value, label, allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a plain data object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} must be a plain data object`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const clean = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !allowedKeys.has(key)) throw new Error(`Unsupported ${label} field: ${typeof key === 'string' ? key : 'symbol'}`);
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error(`${label} must contain enumerable data fields only`);
    clean[key] = descriptor.value;
  }
  return clean;
}
function dataMethod(value, key, label) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) throw new Error(`${label} must be an object`);
  let current = value;
  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) {
      if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') throw new Error(`${label} ${key} must be a data method`);
      return descriptor.value.bind(value);
    }
    current = Object.getPrototypeOf(current);
  }
  throw new Error(`${label} ${key} must be a data method`);
}
function normalizeSignal(signal) {
  if (signal == null) return undefined;
  const AbortSignalCtor = globalThis.AbortSignal;
  if (typeof AbortSignalCtor !== 'function' || !(signal instanceof AbortSignalCtor)) throw new Error('Agent workflow signal must be an AbortSignal');
  return signal;
}
function safeErrorMessage(error) {
  if (typeof error === 'string') return error.slice(0, MAX_WORKFLOW_ERROR_CHARS);
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) return 'Agent workflow task failed';
  let current = error;
  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, 'message');
    if (descriptor) {
      if (!Object.hasOwn(descriptor, 'value')) return 'Agent workflow task failed';
      return typeof descriptor.value === 'string' ? descriptor.value.slice(0, MAX_WORKFLOW_ERROR_CHARS) : 'Agent workflow task failed';
    }
    current = Object.getPrototypeOf(current);
  }
  return 'Agent workflow task failed';
}
function normalizeInputs(inputs, workflow) {
  const clean = normalizeBoundedModelInput(inputs ?? {}, 'Agent workflow inputs', { maxBytes: DEFAULT_MODEL_INPUT_BYTES });
  if (!clean || typeof clean !== 'object' || Array.isArray(clean)) throw new Error('Agent workflow inputs must be an object');
  const taskIds = new Set(workflow.tasks.map((task) => task.id));
  for (const key of Object.keys(clean)) if (!taskIds.has(key)) throw new Error(`Unknown Agent workflow input task: ${key}`);
  return clean;
}
function taskInput(inputs, taskId) {
  return Object.hasOwn(inputs, taskId) ? inputs[taskId] : {};
}
function resolveSemanticIds(graph, semanticIds = [], label) {
  if (!Array.isArray(semanticIds)) throw new Error(`${label} values must be an array`);
  const result = [];
  for (let index = 0; index < semanticIds.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(semanticIds, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string' || !descriptor.value.trim()) throw new Error(`${label} values must be dense non-empty strings`);
    const semanticId = descriptor.value.trim();
    const matches = findCreativeObjects(graph, { semanticId });
    if (matches.length !== 1) throw new Error(`${label} ${semanticId} resolved to ${matches.length} objects`);
    result.push(matches[0].id);
  }
  return result;
}

export class AgentWorkflowExecutionError extends Error {
  constructor(taskId, error, workflow) {
    super(`Agent workflow task ${taskId} failed: ${safeErrorMessage(error)}`);
    this.name = 'AgentWorkflowExecutionError';
    this.code = 'AGENT_WORKFLOW_EXECUTION_FAILED';
    this.taskId = taskId;
    this.workflow = workflow;
    this.cause = error;
  }
}

export class AgentWorkflowSession {
  constructor(options = {}) {
    const config = dataOptions(options, 'Agent workflow session options', SESSION_OPTION_KEYS);
    const executeModel = dataMethod(config.router, 'execute', 'Agent workflow router');
    this.router = Object.freeze({ execute: executeModel });
    this.getGraph = requireFunction(config.getGraph, 'Agent workflow getGraph');
    this.assetUri = requireFunction(config.assetUri ?? ((assetId) => `media://asset/${assetId}`), 'Agent workflow assetUri');
  }

  async execute(workflow, options = {}) {
    let state = assertAgentWorkflow(workflow);
    const config = dataOptions(options, 'Agent workflow execution options', EXECUTION_OPTION_KEYS);
    const signal = normalizeSignal(config.signal);
    const inputs = normalizeInputs(config.inputs ?? {}, state);
    const baseGraph = this.getGraph();
    assertAgentPlanMatchesGraph(baseGraph, state.plan);
    let previewGraph = baseGraph;
    const taskResults = Object.create(null);
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
          const result = await runSemanticEnrichmentModel(this.router, previewGraph, { ...task.payload, modelInput: taskInput(inputs, task.id), signal });
          operations = result.operations;
          summary = `Semantic enrichment via ${result.backendId}`;
        } else if (task.kind === 'generate-media') {
          const sourceNodeIds = [...new Set([...(task.payload.sourceNodeIds ?? []), ...resolveSemanticIds(previewGraph, task.payload.sourceSemanticIds, 'Generation source semantic id')])];
          const creativeObjectIds = [...new Set([...(task.payload.creativeObjectIds ?? []), ...resolveSemanticIds(previewGraph, task.payload.creativeObjectSemanticIds, 'Generation creative object semantic id')])];
          const result = await runGeneratedMediaModel(this.router, previewGraph, { ...task.payload, sourceNodeIds, creativeObjectIds, modelInput: taskInput(inputs, task.id), parentPlanId: state.plan.id, signal });
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
