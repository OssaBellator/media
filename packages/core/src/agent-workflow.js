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

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}
function cloneJson(value, label) {
  try { return JSON.parse(canonicalOperationLogJson(value)); }
  catch (error) { throw new Error(`${label} must be JSON-safe: ${error.message}`, { cause: error }); }
}
function utf8Bytes(value) { return new TextEncoder().encode(value).byteLength; }
function normalizeIds(values, label) {
  if (!Array.isArray(values)) throw new Error(`${label} must be an array`);
  return [...new Set(values.map((value) => requireString(String(value), label)))];
}
function validateTaskPayload(kind, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error(`Agent workflow ${kind} payload must be an object`);
  if (kind === 'generate-media') {
    const operation = requireString(payload.operation, 'Agent generate-media operation');
    if (!GENERATED_OPERATION_SET.has(operation)) throw new Error(`Unsupported Agent generate-media operation: ${operation}`);
    normalizeIds(payload.sourceNodeIds ?? [], 'Agent generate-media sourceNodeIds');
    normalizeIds(payload.creativeObjectIds ?? [], 'Agent generate-media creativeObjectIds');
    normalizeIds(payload.sourceSemanticIds ?? [], 'Agent generate-media sourceSemanticIds');
    normalizeIds(payload.creativeObjectSemanticIds ?? [], 'Agent generate-media creativeObjectSemanticIds');
    if (payload.settings !== undefined) cloneJson(payload.settings, 'Agent generate-media settings');
    if (payload.intent !== undefined && typeof payload.intent !== 'string') throw new Error('Agent generate-media intent must be a string');
  } else if (kind === 'semantic-enrichment') {
    normalizeIds(payload.sourceNodeIds ?? [], 'Agent semantic-enrichment sourceNodeIds');
    if (payload.permissions !== undefined) cloneJson(payload.permissions, 'Agent semantic-enrichment permissions');
  }
  return cloneJson(payload, `Agent workflow ${kind} payload`);
}
function normalizeTask(task) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) throw new Error('Agent workflow task must be an object');
  const id = requireString(task.id, 'Agent workflow task id');
  const kind = requireString(task.kind, 'Agent workflow task kind');
  if (!TASK_KIND_SET.has(kind)) throw new Error(`Unsupported Agent workflow task kind: ${kind}`);
  const dependsOn = normalizeIds(task.dependsOn ?? [], 'Agent workflow dependency');
  return { id, kind, dependsOn, payload: validateTaskPayload(kind, task.payload ?? {}), optional: Boolean(task.optional), status: 'pending' };
}

export function assertAgentWorkflow(workflow) {
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) throw new Error('Agent workflow must be an object');
  if (workflow.schema !== AGENT_WORKFLOW_SCHEMA) throw new Error(`Unsupported Agent workflow schema: ${workflow.schema}`);
  requireString(workflow.id, 'Agent workflow id');
  assertAgentPlan(workflow.plan);
  if (!Array.isArray(workflow.tasks)) throw new Error('Agent workflow tasks must be an array');
  if (workflow.tasks.length > MAX_AGENT_WORKFLOW_TASKS) throw new Error(`Agent workflow exceeds ${MAX_AGENT_WORKFLOW_TASKS} tasks`);
  assertPipelineAcyclic({ tasks: workflow.tasks });
  for (const task of workflow.tasks) {
    if (!TASK_KIND_SET.has(task.kind)) throw new Error(`Unsupported Agent workflow task kind: ${task.kind}`);
    if (!['pending', 'running', 'complete', 'failed'].includes(task.status)) throw new Error(`Unsupported Agent workflow task status: ${task.status}`);
    validateTaskPayload(task.kind, task.payload ?? {});
  }
  const canonical = canonicalOperationLogJson(workflow);
  if (utf8Bytes(canonical) > MAX_AGENT_WORKFLOW_BYTES) throw new Error(`Agent workflow exceeds ${MAX_AGENT_WORKFLOW_BYTES} bytes`);
  return workflow;
}

export function createAgentWorkflow(plan, tasks = [], { id = `workflow:${plan?.id ?? 'agent'}`, createdAt = new Date().toISOString() } = {}) {
  assertAgentPlan(plan);
  if (!Array.isArray(tasks)) throw new Error('Agent workflow tasks must be an array');
  const workflow = { schema: AGENT_WORKFLOW_SCHEMA, id: requireString(id, 'Agent workflow id'), createdAt: requireString(createdAt, 'Agent workflow createdAt'), plan: cloneJson(plan, 'Agent workflow plan'), tasks: tasks.map(normalizeTask) };
  return assertAgentWorkflow(workflow);
}

export function runnableAgentWorkflowTasks(workflow) {
  assertAgentWorkflow(workflow);
  return runnablePipelineTasks(workflow);
}

export function startAgentWorkflowTask(workflow, taskId) {
  const runnable = new Set(runnableAgentWorkflowTasks(workflow).map((task) => task.id));
  if (!runnable.has(taskId)) throw new Error(`Agent workflow task is not runnable: ${taskId}`);
  return assertAgentWorkflow(updatePipelineTask(workflow, taskId, { status: 'running' }));
}

export function completeAgentWorkflowTask(workflow, taskId) {
  const task = workflow.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error(`Unknown Agent workflow task: ${taskId}`);
  if (!['running', 'pending'].includes(task.status)) throw new Error(`Agent workflow task cannot complete from ${task.status}`);
  if (task.status === 'pending' && !runnableAgentWorkflowTasks(workflow).some((item) => item.id === taskId)) throw new Error(`Agent workflow task is not runnable: ${taskId}`);
  return assertAgentWorkflow(updatePipelineTask(workflow, taskId, { status: 'complete' }));
}

export function failAgentWorkflowTask(workflow, taskId, error) {
  const task = workflow.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error(`Unknown Agent workflow task: ${taskId}`);
  let next = updatePipelineTask(workflow, taskId, { status: 'failed', error: String(error?.message ?? error) });
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
  assertAgentWorkflow(workflow);
  const required = workflow.tasks.filter((task) => !task.optional);
  const optional = workflow.tasks.filter((task) => task.optional);
  const requiredComplete = required.filter((task) => task.status === 'complete').length;
  const requiredFailed = required.filter((task) => task.status === 'failed').length;
  const running = workflow.tasks.filter((task) => task.status === 'running').length;
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
  assertAgentWorkflow(workflow);
  const tasks = new Map(workflow.tasks.map((task) => [task.id, task]));
  const emitted = new Set();
  const result = [];
  while (result.length < workflow.tasks.length) {
    const ready = [...tasks.values()].filter((task) => !emitted.has(task.id) && task.dependsOn.every((id) => emitted.has(id))).sort((a, b) => a.id.localeCompare(b.id));
    if (!ready.length) throw new Error('Agent workflow task order is cyclic');
    for (const task of ready) { emitted.add(task.id); result.push(task); }
  }
  return result;
}

export function materializeAgentWorkflowPlan(graph, workflow, taskResults = {}) {
  assertAgentWorkflow(workflow);
  assertAgentPlanMatchesGraph(graph, workflow.plan);
  const progress = agentWorkflowProgress(workflow);
  if (!progress.done || progress.blocked) throw new Error('Agent workflow is not complete');
  if (!taskResults || typeof taskResults !== 'object' || Array.isArray(taskResults)) throw new Error('Agent workflow taskResults must be an object');
  const operations = [...workflow.plan.operations];
  const resultMetadata = [];
  for (const task of orderedAgentWorkflowTasks(workflow)) {
    if (task.optional && task.status === 'failed') {
      resultMetadata.push({ id: task.id, kind: task.kind, skipped: true });
      continue;
    }
    const result = taskResults[task.id];
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error(`Missing Agent workflow result: ${task.id}`);
    if (!Array.isArray(result.operations)) throw new Error(`Agent workflow result ${task.id} requires operations`);
    result.operations.forEach(assertValidOperation);
    operations.push(...cloneJson(result.operations, `Agent workflow result ${task.id} operations`));
    resultMetadata.push({ id: task.id, kind: task.kind, operationCount: result.operations.length, ...(result.summary ? { summary: String(result.summary).slice(0, 512) } : {}) });
  }
  return reviseAgentPlan(graph, workflow.plan, operations, {
    summary: workflow.plan.summary,
    metadata: {
      ...(workflow.plan.metadata ?? {}),
      workflow: { id: workflow.id, tasks: resultMetadata, materializedAt: new Date().toISOString() },
    },
  });
}
