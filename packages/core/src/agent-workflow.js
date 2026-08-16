import { assertAgentPlan, assertAgentPlanMatchesGraph, reviseAgentPlan } from './agent-plan.js';
import { GENERATED_MEDIA_OPERATIONS } from './generated-media.js';
import { canonicalOperationLogJson } from './operation-log.js';
import { assertValidOperation } from './operations.js';
import { assertPipelineAcyclic, runnablePipelineTasks, updatePipelineTask } from './pipeline.js';

export const AGENT_WORKFLOW_SCHEMA = 'media.agent-workflow.v1';
export const AGENT_WORKFLOW_TASK_KINDS = Object.freeze(['generate-media', 'semantic-enrichment']);
export const MAX_AGENT_WORKFLOW_TASKS = 256;
export const MAX_AGENT_WORKFLOW_BYTES = 1024 * 1024;
const TASK_KIND_SET = new Set(AGENT_WORKFLOW_TASK_KINDS);
const GENERATED_OPERATION_SET = new Set(GENERATED_MEDIA_OPERATIONS);
const MAX_AGENT_WORKFLOW_ERROR_CHARS = 1024;
const WORKFLOW_OPTION_KEYS = new Set(['id', 'createdAt']);

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}
function cloneJson(value, label) {
  try { return JSON.parse(canonicalOperationLogJson(value)); }
  catch (error) { throw new Error(`${label} must be JSON-safe: ${error.message}`, { cause: error }); }
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
function errorMessage(error) {
  if (typeof error === 'string') return error.slice(0, MAX_AGENT_WORKFLOW_ERROR_CHARS);
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) return 'Agent workflow task failed';
  let current = error;
  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, 'message');
    if (descriptor) {
      if (!Object.hasOwn(descriptor, 'value')) return 'Agent workflow task failed';
      return typeof descriptor.value === 'string' ? descriptor.value.slice(0, MAX_AGENT_WORKFLOW_ERROR_CHARS) : 'Agent workflow task failed';
    }
    current = Object.getPrototypeOf(current);
  }
  return 'Agent workflow task failed';
}
function utf8Bytes(value) { return new TextEncoder().encode(value).byteLength; }
function normalizeIds(values, label) {
  if (!Array.isArray(values)) throw new Error(`${label} must be an array`);
  const result = [];
  const seen = new Set();
  for (let index = 0; index < values.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(values, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error(`${label} must contain dense enumerable data values only`);
    const value = requireString(descriptor.value, label);
    if (!seen.has(value)) { seen.add(value); result.push(value); }
  }
  return result;
}
function validateTaskPayload(kind, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error(`Agent workflow ${kind} payload must be an object`);
  const clean = cloneJson(payload, `Agent workflow ${kind} payload`);
  if (kind === 'generate-media') {
    const operation = requireString(clean.operation, 'Agent generate-media operation');
    if (!GENERATED_OPERATION_SET.has(operation)) throw new Error(`Unsupported Agent generate-media operation: ${operation}`);
    normalizeIds(clean.sourceNodeIds ?? [], 'Agent generate-media sourceNodeIds');
    normalizeIds(clean.creativeObjectIds ?? [], 'Agent generate-media creativeObjectIds');
    normalizeIds(clean.sourceSemanticIds ?? [], 'Agent generate-media sourceSemanticIds');
    normalizeIds(clean.creativeObjectSemanticIds ?? [], 'Agent generate-media creativeObjectSemanticIds');
    if (clean.settings !== undefined) cloneJson(clean.settings, 'Agent generate-media settings');
    if (clean.intent !== undefined && typeof clean.intent !== 'string') throw new Error('Agent generate-media intent must be a string');
  } else if (kind === 'semantic-enrichment') {
    normalizeIds(clean.sourceNodeIds ?? [], 'Agent semantic-enrichment sourceNodeIds');
    if (clean.permissions !== undefined) cloneJson(clean.permissions, 'Agent semantic-enrichment permissions');
  }
  return clean;
}
function normalizeTask(task) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) throw new Error('Agent workflow task must be an object');
  const clean = cloneJson(task, 'Agent workflow task');
  const id = requireString(clean.id, 'Agent workflow task id');
  const kind = requireString(clean.kind, 'Agent workflow task kind');
  if (!TASK_KIND_SET.has(kind)) throw new Error(`Unsupported Agent workflow task kind: ${kind}`);
  const dependsOn = normalizeIds(clean.dependsOn ?? [], 'Agent workflow dependency');
  if (clean.optional !== undefined && typeof clean.optional !== 'boolean') throw new Error('Agent workflow task optional must be a boolean');
  return { id, kind, dependsOn, payload: validateTaskPayload(kind, clean.payload ?? {}), optional: clean.optional ?? false, status: 'pending' };
}

export function assertAgentWorkflow(workflow) {
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) throw new Error('Agent workflow must be an object');
  const clean = cloneJson(workflow, 'Agent workflow');
  if (clean.schema !== AGENT_WORKFLOW_SCHEMA) throw new Error(`Unsupported Agent workflow schema: ${clean.schema}`);
  requireString(clean.id, 'Agent workflow id');
  assertAgentPlan(clean.plan);
  if (!Array.isArray(clean.tasks)) throw new Error('Agent workflow tasks must be an array');
  if (clean.tasks.length > MAX_AGENT_WORKFLOW_TASKS) throw new Error(`Agent workflow exceeds ${MAX_AGENT_WORKFLOW_TASKS} tasks`);
  assertPipelineAcyclic({ tasks: clean.tasks });
  for (const task of clean.tasks) {
    if (!TASK_KIND_SET.has(task.kind)) throw new Error(`Unsupported Agent workflow task kind: ${task.kind}`);
    if (!['pending', 'running', 'complete', 'failed'].includes(task.status)) throw new Error(`Unsupported Agent workflow task status: ${task.status}`);
    validateTaskPayload(task.kind, task.payload ?? {});
  }
  const canonical = canonicalOperationLogJson(clean);
  if (utf8Bytes(canonical) > MAX_AGENT_WORKFLOW_BYTES) throw new Error(`Agent workflow exceeds ${MAX_AGENT_WORKFLOW_BYTES} bytes`);
  return clean;
}

export function createAgentWorkflow(plan, tasks = [], options = {}) {
  const cleanPlan = cloneJson(plan, 'Agent workflow plan');
  assertAgentPlan(cleanPlan);
  const cleanTasks = cloneJson(tasks, 'Agent workflow tasks');
  if (!Array.isArray(cleanTasks)) throw new Error('Agent workflow tasks must be an array');
  const config = dataOptions(options, 'Agent workflow options', WORKFLOW_OPTION_KEYS);
  const id = config.id ?? `workflow:${cleanPlan.id}`;
  const createdAt = config.createdAt ?? new Date().toISOString();
  const workflow = { schema: AGENT_WORKFLOW_SCHEMA, id: requireString(id, 'Agent workflow id'), createdAt: requireString(createdAt, 'Agent workflow createdAt'), plan: cleanPlan, tasks: cleanTasks.map(normalizeTask) };
  return assertAgentWorkflow(workflow);
}

export function runnableAgentWorkflowTasks(workflow) {
  const clean = assertAgentWorkflow(workflow);
  return runnablePipelineTasks(clean);
}

export function startAgentWorkflowTask(workflow, taskId) {
  const clean = assertAgentWorkflow(workflow);
  const runnable = new Set(runnableAgentWorkflowTasks(clean).map((task) => task.id));
  if (!runnable.has(taskId)) throw new Error(`Agent workflow task is not runnable: ${taskId}`);
  return assertAgentWorkflow(updatePipelineTask(clean, taskId, { status: 'running' }));
}

export function completeAgentWorkflowTask(workflow, taskId) {
  const clean = assertAgentWorkflow(workflow);
  const task = clean.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error(`Unknown Agent workflow task: ${taskId}`);
  if (!['running', 'pending'].includes(task.status)) throw new Error(`Agent workflow task cannot complete from ${task.status}`);
  if (task.status === 'pending' && !runnableAgentWorkflowTasks(clean).some((item) => item.id === taskId)) throw new Error(`Agent workflow task is not runnable: ${taskId}`);
  return assertAgentWorkflow(updatePipelineTask(clean, taskId, { status: 'complete' }));
}

export function failAgentWorkflowTask(workflow, taskId, error) {
  const clean = assertAgentWorkflow(workflow);
  const task = clean.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error(`Unknown Agent workflow task: ${taskId}`);
  let next = updatePipelineTask(clean, taskId, { status: 'failed', error: errorMessage(error) });
  let changed = true;
  while (changed) {
    changed = false;
    const failed = new Set(next.tasks.filter((item) => item.status === 'failed').map((item) => item.id));
    for (const item of next.tasks) {
      if (item.status !== 'pending' || !item.dependsOn.some((id) => failed.has(id))) continue;
      next = updatePipelineTask(next, item.id, { status: 'failed', error: 'dependency-failed' });
      changed = true;
    }
  }
  return assertAgentWorkflow(next);
}

export function agentWorkflowProgress(workflow) {
  const clean = assertAgentWorkflow(workflow);
  const required = clean.tasks.filter((task) => !task.optional);
  const optional = clean.tasks.filter((task) => task.optional);
  const requiredComplete = required.filter((task) => task.status === 'complete').length;
  const requiredFailed = required.filter((task) => task.status === 'failed').length;
  const running = clean.tasks.filter((task) => task.status === 'running').length;
  const optionalTerminal = optional.filter((task) => ['complete', 'failed'].includes(task.status)).length;
  return {
    required: required.length,
    complete: requiredComplete,
    failed: requiredFailed,
    running,
    optional: optional.length,
    optionalTerminal,
    ratio: required.length ? requiredComplete / required.length : 1,
    done: requiredComplete === required.length && optionalTerminal === optional.length,
    blocked: requiredFailed > 0,
  };
}

export function orderedAgentWorkflowTasks(workflow) {
  const clean = assertAgentWorkflow(workflow);
  const tasks = new Map(clean.tasks.map((task) => [task.id, task]));
  const emitted = new Set();
  const result = [];
  while (result.length < clean.tasks.length) {
    const ready = [...tasks.values()].filter((task) => !emitted.has(task.id) && task.dependsOn.every((id) => emitted.has(id))).sort((a, b) => a.id.localeCompare(b.id));
    if (!ready.length) throw new Error('Agent workflow task order is cyclic');
    for (const task of ready) { emitted.add(task.id); result.push(task); }
  }
  return result;
}

export function materializeAgentWorkflowPlan(graph, workflow, taskResults = {}) {
  const clean = assertAgentWorkflow(workflow);
  assertAgentPlanMatchesGraph(graph, clean.plan);
  const progress = agentWorkflowProgress(clean);
  if (!progress.done || progress.blocked) throw new Error('Agent workflow is not complete');
  if (!taskResults || typeof taskResults !== 'object' || Array.isArray(taskResults)) throw new Error('Agent workflow taskResults must be an object');
  const cleanResults = cloneJson(taskResults, 'Agent workflow taskResults');
  const operations = [...clean.plan.operations];
  const resultMetadata = [];
  for (const task of orderedAgentWorkflowTasks(clean)) {
    if (task.optional && task.status === 'failed') {
      resultMetadata.push({ id: task.id, kind: task.kind, skipped: true });
      continue;
    }
    const result = cleanResults[task.id];
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error(`Missing Agent workflow result: ${task.id}`);
    if (!Array.isArray(result.operations)) throw new Error(`Agent workflow result ${task.id} requires operations`);
    result.operations.forEach(assertValidOperation);
    operations.push(...cloneJson(result.operations, `Agent workflow result ${task.id} operations`));
    if (result.summary !== undefined && typeof result.summary !== 'string') throw new Error(`Agent workflow result ${task.id} summary must be a string`);
    resultMetadata.push({ id: task.id, kind: task.kind, operationCount: result.operations.length, ...(result.summary ? { summary: result.summary.slice(0, 512) } : {}) });
  }
  return reviseAgentPlan(graph, clean.plan, operations, {
    summary: clean.plan.summary,
    metadata: {
      ...(clean.plan.metadata ?? {}),
      workflow: { id: clean.id, tasks: resultMetadata, materializedAt: new Date().toISOString() },
    },
  });
}
