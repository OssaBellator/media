import { createAgentPlan } from '../../packages/core/src/agent-plan.js';
import { AgentProposalSession } from './agent-proposal-session.js';
import { StudioAgentController } from './agent-controller.js';
import { renderAgentReviewPanel, selectedAgentOperationIndexes } from './agent-review-panel.js';
import { HistoryJournalSession } from './history-journal-session.js';

const sessionRecords = new WeakMap();
let currentRecord = null;
let installed = false;
let refreshQueued = false;

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
  return { historySession, proposalSession, controller: new StudioAgentController({ proposalSession }) };
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
  queueReviewRefresh();
  return Promise.resolve(proposalNoOp(record.historySession));
}

function reviewRoot() {
  return globalThis.document?.querySelector?.('.agent-workspace') ?? null;
}

function controllerState() {
  if (!currentRecord) return { status: 'idle', plan: null, review: null, error: null, workflow: null };
  return currentRecord.controller.snapshot();
}

function refreshReview() {
  refreshQueued = false;
  const root = reviewRoot();
  if (root) renderAgentReviewPanel(root, controllerState());
}

function queueReviewRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  queueMicrotask(refreshReview);
}

function rerenderStudio() {
  const active = globalThis.document?.querySelector?.('[data-workspace].active');
  if (active && typeof active.click === 'function') active.click();
  else queueReviewRefresh();
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
  queueReviewRefresh();
}

function revisePending(root) {
  if (!currentRecord?.controller.hasPending()) return;
  currentRecord.controller.discard();
  const form = root.querySelector('#agent-form');
  if (typeof form?.requestSubmit === 'function') form.requestSubmit();
  else form?.dispatchEvent?.(new Event('submit', { bubbles: true, cancelable: true }));
}

function handleReviewClick(event) {
  const root = reviewRoot();
  if (!root) return;
  const apply = event.target?.closest?.('[data-agent-apply]');
  const discard = event.target?.closest?.('[data-agent-discard]');
  const revise = event.target?.closest?.('[data-agent-revise]');
  if (!apply && !discard && !revise) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
  if (apply) applyPending(root, apply);
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
  const originalEdit = HistoryJournalSession.prototype.edit;
  HistoryJournalSession.prototype.edit = function reviewFirstEdit(label, operations, metadata = {}, options = {}) {
    const isLegacyAgentCommand = metadata?.source === 'agent' && typeof metadata?.intent === 'string' && !metadata?.agentPlan;
    if (!isLegacyAgentCommand) return originalEdit.call(this, label, operations, metadata, options);
    return interceptAgentEdit(recordFor(this, originalEdit), label, operations, metadata);
  };
  globalThis.document?.addEventListener?.('click', handleReviewClick, true);
  globalThis.document?.addEventListener?.('change', handleReviewSelection, true);
  if (globalThis.MutationObserver && globalThis.document?.documentElement) {
    new MutationObserver(queueReviewRefresh).observe(globalThis.document.documentElement, { childList: true, subtree: true });
  }
  queueReviewRefresh();
}
