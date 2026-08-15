import { createAgentPlanTransaction, selectAgentPlanOperations } from '../../packages/core/src/agent-plan.js';
import { createAgentPlanReview } from '../../packages/core/src/agent-review.js';
import { proposeWithProvider } from '../../packages/core/src/providers.js';

function requireFunction(value, label) {
  if (typeof value !== 'function') throw new Error(`${label} must be a function`);
  return value;
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
    this.pending = selectAgentPlanOperations(this.getGraph(), this.pending, operationIndexes, options);
    return this.snapshot();
  }

  discard() {
    const plan = this.pending;
    this.pending = null;
    return plan;
  }

  async apply({ operationIndexes = null, metadata = {} } = {}) {
    if (!this.pending) throw new Error('No Agent proposal is pending');
    if (operationIndexes != null) this.select(operationIndexes);
    const plan = this.pending;
    const transaction = createAgentPlanTransaction(this.getGraph(), plan, { metadata });
    const result = await this.commit(transaction.label, transaction.operations, transaction.metadata);
    this.pending = null;
    return { plan, transaction, result };
  }
}
