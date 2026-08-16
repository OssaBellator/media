import { assertAgentPlanMatchesGraph, createAgentPlanTransaction, selectAgentPlanOperations } from '../../packages/core/src/agent-plan.js';
import { createAgentPlanReview } from '../../packages/core/src/agent-review.js';
import { proposeWithProvider } from '../../packages/core/src/providers.js';
import { normalizeStudioPersistContext } from './persistence-context.js';

function requireFunction(value, label) {
  if (typeof value !== 'function') throw new Error(`${label} must be a function`);
  return value;
}

const APPLY_OPTION_KEYS = new Set(['operationIndexes', 'metadata', 'persistContext']);

function dataOptions(value, label, allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a plain data object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} must be a plain data object`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const clean = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !allowedKeys.has(key)) throw new Error(`Unsupported ${label} field: ${String(key)}`);
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error(`${label} must contain enumerable data fields only`);
    clean[key] = descriptor.value;
  }
  return clean;
}

function persistContextForOperations(persistContext, operations) {
  const safe = normalizeStudioPersistContext(persistContext);
  if (!safe) return undefined;
  const assetIds = new Set(operations.filter((operation) => operation.type === 'node.add' && operation.node?.kind === 'asset').map((operation) => operation.node.id));
  return { assetWrites: safe.assetWrites.filter((write) => assetIds.has(write.assetId)) };
}

function atomicReviewRequired(plan) {
  return plan?.metadata?.review?.atomic === true || plan?.metadata?.creativeObjectRestyle?.atomic === true;
}

function assertAtomicSelection(plan, operationIndexes) {
  if (!atomicReviewRequired(plan)) return;
  const indexes = [];
  for (let position = 0; position < operationIndexes.length; position += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(operationIndexes, String(position));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || !Number.isSafeInteger(descriptor.value)) throw new Error('Atomic Agent operation selection requires dense integer indexes');
    indexes.push(descriptor.value);
  }
  const expected = plan.operations.length;
  const sorted = [...new Set(indexes)].sort((a, b) => a - b);
  const complete = indexes.length === expected && sorted.length === expected && sorted.every((value, index) => value === index);
  if (!complete) throw new Error('This Agent proposal requires atomic review and cannot apply a partial operation selection');
}

export class AgentProposalSession {
  constructor({ provider, getGraph, commit } = {}) {
    if (!provider || typeof provider.plan !== 'function') throw new Error('Agent proposal session requires a planner provider');
    this.provider = provider;
    this.getGraph = requireFunction(getGraph, 'Agent proposal getGraph');
    this.commit = requireFunction(commit, 'Agent proposal commit');
    this.pending = null;
  }

  hasPending() { return Boolean(this.pending); }

  async propose(intent, context = {}, options = {}) {
    const plan = await proposeWithProvider(this.provider, this.getGraph(), intent, context, options);
    this.pending = plan;
    return this.snapshot();
  }

  adopt(plan) {
    const graph = this.getGraph();
    assertAgentPlanMatchesGraph(graph, plan);
    createAgentPlanReview(graph, plan);
    this.pending = plan;
    return this.snapshot();
  }

  snapshot() {
    if (!this.pending) return { status: 'idle', plan: null, review: null, error: null };
    try {
      return { status: 'pending', plan: this.pending, review: createAgentPlanReview(this.getGraph(), this.pending), error: null };
    } catch (error) {
      if (error?.code === 'AGENT_PLAN_STALE') return { status: 'stale', plan: this.pending, review: null, error };
      throw error;
    }
  }

  select(operationIndexes, options = {}) {
    if (!this.pending) throw new Error('No Agent proposal is pending');
    if (!Array.isArray(operationIndexes) || !operationIndexes.length) throw new Error('At least one Agent operation must remain selected');
    assertAtomicSelection(this.pending, operationIndexes);
    if (atomicReviewRequired(this.pending)) return this.snapshot();
    this.pending = selectAgentPlanOperations(this.getGraph(), this.pending, operationIndexes, options);
    return this.snapshot();
  }

  discard() {
    const plan = this.pending;
    this.pending = null;
    return plan;
  }

  async apply(options = {}) {
    if (!this.pending) throw new Error('No Agent proposal is pending');
    const config = dataOptions(options, 'Agent proposal apply options', APPLY_OPTION_KEYS);
    const operationIndexes = config.operationIndexes ?? null;
    if (operationIndexes != null) this.select(operationIndexes);
    const plan = this.pending;
    const transaction = createAgentPlanTransaction(this.getGraph(), plan, { metadata: config.metadata ?? {} });
    const filteredPersistContext = persistContextForOperations(config.persistContext, transaction.operations);
    const result = await this.commit(transaction.label, transaction.operations, transaction.metadata, filteredPersistContext ? { persistContext: filteredPersistContext } : {});
    this.pending = null;
    return { plan, transaction, persistContext: filteredPersistContext, result };
  }
}
