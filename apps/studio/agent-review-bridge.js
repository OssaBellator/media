import { createAgentPlan } from '../../packages/core/src/agent-plan.js';
import { assertAgentWorkflow } from '../../packages/core/src/agent-workflow.js';
import { createModelRouterWorkflowProvider, MAX_PLANNER_INTENT_CHARS, proposeAgentWorkflowWithProvider } from '../../packages/core/src/providers.js';
import { AgentDelegationSession } from './agent-delegation-session.js';
import { AgentProposalSession } from './agent-proposal-session.js';
import { StudioAgentController } from './agent-controller.js';
import { renderAgentReviewPanel, selectedAgentOperationIndexes } from './agent-review-panel.js';
import { AgentWorkflowSession } from './agent-workflow-session.js';
import { HistoryJournalSession } from './history-journal-session.js';
import { getStudioModelRouter } from './studio-services.js';

export const MAX_STUDIO_WORKFLOW_INTENT_CHARS = MAX_PLANNER_INTENT_CHARS;
const MAX_STUDIO_DELEGATION_STATUS_CHARS = 512;

const sessionRecords = new WeakMap();
let currentRecord = null;
let installed = false;
let refreshQueued = false;
let originalHistoryEdit = null;

function noopProposalProvider() {
  return {
    id: 'studio-review-bridge',
    label: 'Studio Agent review bridge',
    capabilities: ['plan'],
    async plan() { throw new Error('Studio Agent review bridge adopts plans produced by the configured Studio planner'); },
  };
}

export function synchronizeHistoryReference(historySession, previousHistory, result) {
  if (!result?.history || result.history === previousHistory) return result;
  previousHistory.present = result.history.present;
  previousHistory.past = result.history.past;
  previousHistory.future = result.history.future;
  historySession.history = previousHistory;
  return { ...result, history: previousHistory, graph: previousHistory.present };
}

export function assertStudioWorkflowIntent(intent) {
  if (typeof intent !== 'string' || !intent.trim()) throw new Error('Agent workflow intent must be non-empty');
  const clean = intent.trim();
  if (clean.length > MAX_STUDIO_WORKFLOW_INTENT_CHARS) throw new Error(`Agent workflow intent exceeds ${MAX_STUDIO_WORKFLOW_INTENT_CHARS} characters`);
  return clean;
}

function boundedDelegationMessage(value) {
  const text = String(value ?? 'Agent workflow failed');
  return text.length <= MAX_STUDIO_DELEGATION_STATUS_CHARS ? text : `${text.slice(0, MAX_STUDIO_DELEGATION_STATUS_CHARS - 1)}…`;
}

export function studioWorkflowDelegationAvailable(router) {
  if (!router || typeof router.execute !== 'function' || typeof router.list !== 'function') return false;
  try { return router.list('plan-workflow').length > 0; }
  catch { return false; }
}

function workflowTaskOperation(task) {
  if (task.kind === 'semantic-enrichment') return 'analyze-media';
  if (task.kind === 'generate-media') return task.payload.operation;
  throw new Error(`Unsupported Agent workflow task kind: ${task.kind}`);
}

export function inspectStudioWorkflowExecutionCapabilities(workflow, router) {
  assertAgentWorkflow(workflow);
  if (!router || typeof router.list !== 'function') throw new Error('Agent workflow execution requires a model router');
  const requiredOperations = new Set();
  const optionalOperations = new Set();
  const missingRequiredOperations = new Set();
  const missingOptionalOperations = new Set();
  for (const task of workflow.tasks) {
    const operation = workflowTaskOperation(task);
    const target = task.optional ? optionalOperations : requiredOperations;
    target.add(operation);
    let available = false;
    try { available = router.list(operation, task.payload?.policy ?? {}).length > 0; } catch { available = false; }
    if (!available) (task.optional ? missingOptionalOperations : missingRequiredOperations).add(operation);
  }
  return {
    requiredOperations: [...requiredOperations].sort(),
    optionalOperations: [...optionalOperations].sort(),
    missingRequiredOperations: [...missingRequiredOperations].sort(),
    missingOptionalOperations: [...missingOptionalOperations].sort(),
  };
}

function createSessionRecord(historySession, originalEdit) {
  const proposalSession = new AgentProposalSession({
    provider: noopProposalProvider(),
    getGraph: () => historySession.history.present,
    commit: async (label, operations, metadata, options) => {
      const previousHistory = historySession.history;
      const result = await originalEdit.call(historySession, label, operations, metadata, options);
      return synchronizeHistoryReference(historySession, previousHistory, result);
    },
  });
  return {
    historySession,
    proposalSession,
    delegationRouter: null,
    delegationSession: null,
    delegationBusy: false,
    delegationError: null,
    controller: new StudioAgentController({ proposalSession }),
  };
}

function recordFor(historySession, originalEdit) {
  let record = sessionRecords.get(historySession);
  if (!record) {
    record = createSessionRecord(historySession, originalEdit);
    sessionRecords.set(historySession, record);
  }
  currentRecord = record;
  return record;
}

export function registerStudioAgentReviewSession(historySession) {
  if (!(historySession instanceof HistoryJournalSession)) throw new Error('Studio Agent review registration requires a HistoryJournalSession');
  if (typeof originalHistoryEdit !== 'function') throw new Error('Studio Agent review bridge must be installed before registering a session');
  const record = recordFor(historySession, originalHistoryEdit);
  scheduleReviewRefresh();
  return record.controller;
}

function proposalNoOp(historySession) {
  return {
    history: historySession.history,
    graph: historySession.history.present,
    log: historySession.projectJournal?.log ?? null,
    entry: null,
    transaction: null,
    action: 'agent-proposal',
    noOp: true,
  };
}

function interceptAgentEdit(record, label, operations, metadata) {
  if (record.controller.hasPending()) return Promise.reject(new Error('Review or discard the pending Agent proposal before planning another'));
  const plan = createAgentPlan(record.historySession.history.present, {
    intent: metadata.intent,
    summary: String(label ?? ''),
    operations,
    providerId: metadata.providerId ?? 'local',
    providerLabel: metadata.providerLabel ?? 'Local deterministic planner',
    metadata: { studioReviewBridge: true },
  });
  record.proposalSession.adopt(plan);
  record.delegationError = null;
  scheduleReviewRefresh();
  return Promise.resolve(proposalNoOp(record.historySession));
}

function reviewRoot() {
  return globalThis.document?.querySelector?.('.agent-workspace') ?? null;
}

function controllerState() {
  if (!currentRecord) return { status: 'idle', plan: null, review: null, error: null, workflow: null };
  return currentRecord.controller.snapshot();
}

function resolveModelRouter() {
  try { return getStudioModelRouter(); } catch { return null; }
}

function ensureDelegationController(record, router) {
  if (!studioWorkflowDelegationAvailable(router)) throw new Error('No Agent workflow planner backend is registered in Studio');
  if (record.delegationRouter === router && record.delegationSession) return record.controller;
  if (record.controller.hasPending()) throw new Error('Review or discard the pending Agent proposal before changing workflow routing');
  const workflowSession = new AgentWorkflowSession({ router, getGraph: () => record.historySession.history.present });
  const delegationSession = new AgentDelegationSession({ proposalSession: record.proposalSession, workflowSession });
  record.delegationRouter = router;
  record.delegationSession = delegationSession;
  record.controller = new StudioAgentController({ proposalSession: record.proposalSession, delegationSession });
  return record.controller;
}

function delegationControlState() {
  const router = resolveModelRouter();
  const available = studioWorkflowDelegationAvailable(router);
  return {
    available,
    busy: currentRecord?.delegationBusy ?? false,
    pending: currentRecord?.controller.hasPending() ?? false,
    error: currentRecord?.delegationError ?? null,
  };
}

function renderDelegationControl(root) {
  const button = root?.querySelector?.('[data-agent-delegate]');
  if (!button) return;
  const status = root.querySelector?.('[data-agent-delegation-status]');
  const control = delegationControlState();
  button.disabled = !control.available || control.busy || control.pending;
  button.textContent = control.busy ? 'Delegating…' : 'Delegate workflow';
  const copy = control.error
    ? control.error
    : !control.available
      ? 'No workflow model backend registered'
      : control.pending
        ? 'Review the pending proposal first'
        : 'Plan and stage a bounded model workflow';
  button.title = copy;
  if (status) status.textContent = copy;
}

function refreshReview() {
  refreshQueued = false;
  const root = reviewRoot();
  if (!root) return;
  renderAgentReviewPanel(root, controllerState());
  renderDelegationControl(root);
}

function queueReviewRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  queueMicrotask(refreshReview);
}

function scheduleReviewRefresh() {
  setTimeout(queueReviewRefresh, 0);
}

function rerenderStudio() {
  const active = globalThis.document?.querySelector?.('[data-workspace].active');
  if (active && typeof active.click === 'function') active.click();
  else queueReviewRefresh();
}

async function delegateIntent(root, intentOverride = null) {
  if (!currentRecord) throw new Error('Studio Agent session is not ready');
  const record = currentRecord;
  if (record.controller.hasPending()) throw new Error('Review or discard the pending Agent proposal before starting a workflow');
  const input = root.querySelector?.('#agent-input');
  const intent = assertStudioWorkflowIntent(String(intentOverride ?? input?.value ?? ''));
  const router = resolveModelRouter();
  const controller = ensureDelegationController(record, router);
  const provider = createModelRouterWorkflowProvider({ router, contextMode: 'semantic' });
  record.delegationBusy = true;
  record.delegationError = null;
  queueReviewRefresh();
  try {
    const workflow = await proposeAgentWorkflowWithProvider(provider, record.historySession.history.present, intent);
    const capability = inspectStudioWorkflowExecutionCapabilities(workflow, router);
    if (capability.missingRequiredOperations.length) {
      throw new Error(`Agent workflow requires unavailable model operations: ${capability.missingRequiredOperations.join(', ')}`);
    }
    await controller.delegate(workflow);
    if (input) input.value = intent;
  } catch (error) {
    record.delegationError = boundedDelegationMessage(error?.message ?? error);
    throw error;
  } finally {
    record.delegationBusy = false;
    queueReviewRefresh();
  }
}

async function applyPending(root, button) {
  if (!currentRecord || currentRecord.controller.snapshot().status !== 'pending') return;
  const operationIndexes = selectedAgentOperationIndexes(root);
  if (!operationIndexes.length) {
    button.disabled = true;
    button.title = 'Select at least one operation to apply';
    return;
  }
  button.disabled = true;
  try {
    await currentRecord.controller.apply({ operationIndexes, metadata: { reviewSurface: 'studio' } });
    currentRecord.delegationError = null;
    rerenderStudio();
  } catch (error) {
    button.disabled = false;
    button.title = error?.message ?? String(error);
    queueReviewRefresh();
  }
}

function discardPending() {
  if (!currentRecord?.controller.hasPending()) return;
  currentRecord.controller.discard();
  currentRecord.delegationError = null;
  queueReviewRefresh();
}

function revisePending(root) {
  if (!currentRecord?.controller.hasPending()) return;
  const state = currentRecord.controller.snapshot();
  const previousIntent = state.plan?.intent ?? '';
  const delegated = Boolean(state.workflow);
  currentRecord.controller.discard();
  if (delegated) {
    const editedIntent = String(root.querySelector?.('#agent-input')?.value ?? '').trim();
    void delegateIntent(root, editedIntent || previousIntent).catch(() => {});
    return;
  }
  const form = root.querySelector('#agent-form');
  if (typeof form?.requestSubmit === 'function') form.requestSubmit();
  else form?.dispatchEvent?.(new Event('submit', { bubbles: true, cancelable: true }));
}

function handleReviewClick(event) {
  if (event.target?.closest?.('[data-workspace="agent"]')) scheduleReviewRefresh();
  const root = reviewRoot();
  if (!root) return;
  const delegate = event.target?.closest?.('[data-agent-delegate]');
  const apply = event.target?.closest?.('[data-agent-apply]');
  const discard = event.target?.closest?.('[data-agent-discard]');
  const revise = event.target?.closest?.('[data-agent-revise]');
  if (!delegate && !apply && !discard && !revise) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
  if (delegate) void delegateIntent(root).catch(() => {});
  else if (apply) applyPending(root, apply);
  else if (discard) discardPending();
  else revisePending(root);
}

function handleReviewSelection(event) {
  if (!event.target?.matches?.('[data-agent-operation]')) return;
  const root = reviewRoot();
  const apply = root?.querySelector?.('[data-agent-apply]');
  if (apply) apply.disabled = selectedAgentOperationIndexes(root).length === 0;
}

export function installStudioAgentReviewBridge() {
  if (installed) return;
  installed = true;
  originalHistoryEdit = HistoryJournalSession.prototype.edit;
  HistoryJournalSession.prototype.edit = function reviewFirstEdit(label, operations, metadata = {}, options = {}) {
    const isLegacyAgentCommand = metadata?.source === 'agent' && typeof metadata?.intent === 'string' && !metadata?.agentPlan;
    if (!isLegacyAgentCommand) return originalHistoryEdit.call(this, label, operations, metadata, options);
    return interceptAgentEdit(recordFor(this, originalHistoryEdit), label, operations, metadata);
  };
  globalThis.document?.addEventListener?.('click', handleReviewClick, true);
  globalThis.document?.addEventListener?.('change', handleReviewSelection, true);
  scheduleReviewRefresh();
}
