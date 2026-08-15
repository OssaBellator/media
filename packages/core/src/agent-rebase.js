import { agentGraphFingerprint, assertAgentPlanMatchesGraph, createAgentPlan } from './agent-plan.js';
import { transactionConflicts } from './operation-conflicts.js';
import { applyTransaction } from './operations.js';

export class AgentPlanRebaseConflictError extends Error {
  constructor(conflicts = []) {
    super('Agent plan conflicts with intervening project edits');
    this.name = 'AgentPlanRebaseConflictError';
    this.code = 'AGENT_PLAN_REBASE_CONFLICT';
    this.conflicts = conflicts;
  }
}

function transactionId(transaction, index) {
  return typeof transaction?.id === 'string' && transaction.id ? transaction.id : `intervening:${index}`;
}

export function analyzeAgentPlanRebase(baseGraph, currentGraph, plan, interveningTransactions = []) {
  assertAgentPlanMatchesGraph(baseGraph, plan);
  if (!Array.isArray(interveningTransactions)) throw new Error('Intervening transactions must be an array');
  let cursor = baseGraph;
  const conflicts = [];
  for (let index = 0; index < interveningTransactions.length; index += 1) {
    const transaction = interveningTransactions[index];
    if (!transaction || !Array.isArray(transaction.operations)) throw new Error(`Intervening transaction ${index} is invalid`);
    const result = transactionConflicts({ operations: plan.operations }, transaction, { graph: cursor });
    for (const conflict of result.conflicts) conflicts.push({ transactionIndex: index, transactionId: transactionId(transaction, index), ...conflict });
    cursor = applyTransaction(cursor, transaction);
  }
  const reconstructedFingerprint = agentGraphFingerprint(cursor);
  const currentFingerprint = agentGraphFingerprint(currentGraph);
  if (reconstructedFingerprint !== currentFingerprint) throw new Error('Intervening transactions do not reconstruct the current project state');
  return {
    safe: conflicts.length === 0,
    status: conflicts.length ? 'conflict' : 'rebase-safe',
    conflicts,
    transactionIds: interveningTransactions.map(transactionId),
    fromFingerprint: plan.base.fingerprint,
    toFingerprint: currentFingerprint,
  };
}

export function rebaseAgentPlan(baseGraph, currentGraph, plan, interveningTransactions = [], { summary = plan?.summary } = {}) {
  const analysis = analyzeAgentPlanRebase(baseGraph, currentGraph, plan, interveningTransactions);
  if (!analysis.safe) throw new AgentPlanRebaseConflictError(analysis.conflicts);
  return createAgentPlan(currentGraph, {
    id: plan.id,
    revision: plan.revision + 1,
    createdAt: plan.createdAt,
    updatedAt: new Date().toISOString(),
    intent: plan.intent,
    summary,
    operations: plan.operations,
    providerId: plan.provider.id,
    providerLabel: plan.provider.label,
    metadata: {
      ...(plan.metadata ?? {}),
      rebase: {
        previousBaseFingerprint: analysis.fromFingerprint,
        currentBaseFingerprint: analysis.toFingerprint,
        transactionIds: analysis.transactionIds,
      },
    },
  });
}
