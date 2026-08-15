function requireProposalSession(session) {
  if (!session || typeof session.snapshot !== 'function' || typeof session.propose !== 'function' || typeof session.select !== 'function' || typeof session.discard !== 'function' || typeof session.apply !== 'function') throw new Error('Studio Agent controller requires a proposal session');
  return session;
}

function requireDelegationSession(session) {
  if (session == null) return null;
  if (typeof session.snapshot !== 'function' || typeof session.execute !== 'function' || typeof session.select !== 'function' || typeof session.discard !== 'function' || typeof session.apply !== 'function') throw new Error('Studio Agent delegation session is invalid');
  return session;
}

export class StudioAgentController {
  constructor({ proposalSession, delegationSession = null } = {}) {
    this.proposalSession = requireProposalSession(proposalSession);
    this.delegationSession = requireDelegationSession(delegationSession);
  }

  snapshot() {
    const delegated = this.delegationSession?.snapshot();
    return delegated?.workflow ? delegated : { ...this.proposalSession.snapshot(), workflow: null };
  }

  hasPending() {
    return this.snapshot().status !== 'idle';
  }

  async propose(intent, context = {}, options = {}) {
    if (this.hasPending()) throw new Error('Review or discard the pending Agent proposal before planning another');
    await this.proposalSession.propose(intent, context, options);
    return this.snapshot();
  }

  async delegate(workflow, options = {}) {
    if (!this.delegationSession) throw new Error('Staged Agent delegation is not configured');
    if (this.hasPending()) throw new Error('Review or discard the pending Agent proposal before starting a workflow');
    await this.delegationSession.execute(workflow, options);
    return this.snapshot();
  }

  select(operationIndexes, options = {}) {
    return this.snapshot().workflow
      ? this.delegationSession.select(operationIndexes, options)
      : this.proposalSession.select(operationIndexes, options);
  }

  async revise(intent, context = {}, options = {}) {
    if (this.hasPending()) this.discard();
    return this.propose(intent, context, options);
  }

  discard() {
    return this.snapshot().workflow ? this.delegationSession.discard() : this.proposalSession.discard();
  }

  async apply(options = {}) {
    return this.snapshot().workflow ? this.delegationSession.apply(options) : this.proposalSession.apply(options);
  }
}
