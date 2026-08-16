import { assertAgentWorkflow } from '../../packages/core/src/agent-workflow.js';
import { canonicalOperationLogJson } from '../../packages/core/src/operation-log.js';
import { MAX_STUDIO_ASSET_WRITES, normalizeStudioPersistContext } from './persistence-context.js';

export const MAX_AGENT_DELEGATION_REVIEW_TASKS = 64;
export const MAX_AGENT_DELEGATION_REVIEW_ID_CHARS = 160;

const DELEGATION_OPTION_KEYS = new Set(['proposalSession', 'workflowSession']);
const SUMMARY_OPTION_KEYS = new Set(['assetWriteCount']);
const EXECUTION_OPTION_KEYS = new Set(['inputs', 'signal']);
const SELECTION_OPTION_KEYS = new Set(['summary', 'metadata']);
const APPLY_OPTION_KEYS = new Set(['operationIndexes', 'metadata', 'persistContext']);
const EXECUTION_RESULT_KEYS = new Set(['workflow', 'plan', 'taskResults', 'persistContext', 'previewGraph']);
const PROPOSAL_STATE_KEYS = new Set(['status', 'plan', 'review', 'error']);
const APPLY_RESULT_KEYS = new Set(['plan', 'transaction', 'persistContext', 'result']);

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
function cloneJson(value, label) {
  try { return JSON.parse(canonicalOperationLogJson(value)); }
  catch (error) { throw new Error(`${label} must be JSON-safe: ${error.message}`, { cause: error }); }
}
function boundedReviewText(value, limit, label) {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  return value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 1))}…`;
}
function boundedAssetWriteCount(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_STUDIO_ASSET_WRITES) throw new Error(`Agent delegation assetWriteCount must be an integer from 0 to ${MAX_STUDIO_ASSET_WRITES}`);
  return value;
}
function normalizeProposalState(value) {
  return dataOptions(value, 'Agent delegation proposal state', PROPOSAL_STATE_KEYS);
}
function normalizeApplyResult(value) {
  return dataOptions(value, 'Agent delegation apply result', APPLY_RESULT_KEYS);
}
function normalizeExecutionResult(value) {
  const result = dataOptions(value, 'Agent workflow execution result', EXECUTION_RESULT_KEYS);
  if (result.workflow === undefined || result.plan === undefined) throw new Error('Agent workflow execution result requires workflow and plan');
  return {
    workflow: assertAgentWorkflow(result.workflow),
    plan: cloneJson(result.plan, 'Agent workflow execution plan'),
    taskResults: cloneJson(result.taskResults ?? {}, 'Agent workflow task results'),
    persistContext: normalizeStudioPersistContext(result.persistContext ?? null),
    previewGraph: result.previewGraph ?? null,
  };
}

export function summarizeAgentDelegationWorkflow(workflow, options = {}) {
  const clean = assertAgentWorkflow(workflow);
  const config = dataOptions(options, 'Agent delegation summary options', SUMMARY_OPTION_KEYS);
  const assetWriteCount = boundedAssetWriteCount(config.assetWriteCount ?? 0);
  const tasks = clean.tasks.slice(0, MAX_AGENT_DELEGATION_REVIEW_TASKS).map((task) => ({
    id: boundedReviewText(task.id, MAX_AGENT_DELEGATION_REVIEW_ID_CHARS, 'Agent delegation task id'),
    kind: task.kind,
    status: task.status,
    optional: task.optional === true,
    dependencyCount: task.dependsOn.length,
  }));
  return {
    id: boundedReviewText(clean.id, MAX_AGENT_DELEGATION_REVIEW_ID_CHARS, 'Agent delegation workflow id'),
    taskCount: clean.tasks.length,
    assetWriteCount,
    tasks,
    truncatedTaskCount: Math.max(0, clean.tasks.length - tasks.length),
  };
}

export class AgentDelegationSession {
  constructor(options = {}) {
    const config = dataOptions(options, 'Agent delegation session options', DELEGATION_OPTION_KEYS);
    this.proposalSession = config.proposalSession;
    this.workflowSession = config.workflowSession;
    this.proposalSnapshot = dataMethod(this.proposalSession, 'snapshot', 'Agent delegation proposal session');
    this.proposalAdopt = dataMethod(this.proposalSession, 'adopt', 'Agent delegation proposal session');
    this.proposalSelect = dataMethod(this.proposalSession, 'select', 'Agent delegation proposal session');
    this.proposalDiscard = dataMethod(this.proposalSession, 'discard', 'Agent delegation proposal session');
    this.proposalApply = dataMethod(this.proposalSession, 'apply', 'Agent delegation proposal session');
    this.executeWorkflow = dataMethod(this.workflowSession, 'execute', 'Agent delegation workflow session');
    this.pendingWorkflow = null;
  }

  snapshot() {
    const proposal = normalizeProposalState(this.proposalSnapshot());
    return {
      ...proposal,
      workflow: this.pendingWorkflow ? summarizeAgentDelegationWorkflow(this.pendingWorkflow.workflow, {
        assetWriteCount: this.pendingWorkflow.persistContext?.assetWrites.length ?? 0,
      }) : null,
    };
  }

  async execute(workflow, options = {}) {
    const executionOptions = dataOptions(options, 'Agent delegation execution options', EXECUTION_OPTION_KEYS);
    const result = normalizeExecutionResult(await this.executeWorkflow(workflow, executionOptions));
    this.proposalAdopt(result.plan);
    this.pendingWorkflow = result;
    return this.snapshot();
  }

  select(operationIndexes, options = {}) {
    const selectionOptions = dataOptions(options, 'Agent delegation selection options', SELECTION_OPTION_KEYS);
    const state = normalizeProposalState(this.proposalSelect(operationIndexes, selectionOptions));
    return { ...state, workflow: this.snapshot().workflow };
  }

  discard() {
    const plan = this.proposalDiscard();
    const workflow = this.pendingWorkflow;
    this.pendingWorkflow = null;
    return { plan, workflow };
  }

  async apply(options = {}) {
    if (!this.pendingWorkflow) throw new Error('No executed Agent workflow is pending');
    const config = dataOptions(options, 'Agent delegation apply options', APPLY_OPTION_KEYS);
    const workflow = this.pendingWorkflow;
    const result = normalizeApplyResult(await this.proposalApply({ ...config, persistContext: workflow.persistContext }));
    this.pendingWorkflow = null;
    return { ...result, workflow };
  }
}
