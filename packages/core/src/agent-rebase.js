import { agentGraphFingerprint, assertAgentPlanMatchesGraph, createAgentPlan } from './agent-plan.js';
import { canonicalOperationLogJson } from './operation-log.js';
import { transactionConflicts } from './operation-conflicts.js';
import { applyTransaction } from './operations.js';

const AGENT_REBASE_OPTION_KEYS = new Set(['summary']);
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
  const cleanPlan = assertAgentPlanMatchesGraph(baseGraph, plan);
  const cleanTransactions = cloneJson(interveningTransactions, 'Intervening transactions');
  if (!Array.isArray(cleanTransactions)) throw new Error('Intervening transactions must be an array');
  let cursor = baseGraph;
  const conflicts = [];
  for (let index = 0; index < cleanTransactions.length; index += 1) {
    const transaction = cleanTransactions[index];
    if (!transaction || !Array.isArray(transaction.operations)) throw new Error(`Intervening transaction ${index} is invalid`);
    const result = transactionConflicts({ operations: cleanPlan.operations }, transaction, { graph: cursor });
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
    transactionIds: cleanTransactions.map(transactionId),
    fromFingerprint: cleanPlan.base.fingerprint,
    toFingerprint: currentFingerprint,
  };
}

export function rebaseAgentPlan(baseGraph, currentGraph, plan, interveningTransactions = [], options = {}) {
  const cleanPlan = assertAgentPlanMatchesGraph(baseGraph, plan);
  const config = dataOptions(options, 'Agent rebase options', AGENT_REBASE_OPTION_KEYS);
  const summary = config.summary === undefined ? cleanPlan.summary : config.summary;
  if (typeof summary !== 'string') throw new Error('Agent rebase summary must be a string');
  const analysis = analyzeAgentPlanRebase(baseGraph, currentGraph, cleanPlan, interveningTransactions);
  if (!analysis.safe) throw new AgentPlanRebaseConflictError(analysis.conflicts);
  return createAgentPlan(currentGraph, {
    id: cleanPlan.id,
    revision: cleanPlan.revision + 1,
    createdAt: cleanPlan.createdAt,
    updatedAt: new Date().toISOString(),
    intent: cleanPlan.intent,
    summary,
    operations: cleanPlan.operations,
    providerId: cleanPlan.provider.id,
    providerLabel: cleanPlan.provider.label,
    metadata: {
      ...(cleanPlan.metadata ?? {}),
      rebase: {
        previousBaseFingerprint: analysis.fromFingerprint,
        currentBaseFingerprint: analysis.toFingerprint,
        transactionIds: analysis.transactionIds,
      },
    },
  });
}
