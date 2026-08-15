export class AgentDelegationSession {
  constructor({ proposalSession, workflowSession } = {}) {
    if (!proposalSession || typeof proposalSession.adopt !== 'function' || typeof proposalSession.apply !== 'function' || typeof proposalSession.discard !== 'function') throw new Error('Agent delegation session requires a proposal session');
    if (!workflowSession || typeof workflowSession.execute !== 'function') throw new Error('Agent delegation session requires a workflow session');
    this.proposalSession = proposalSession;
    this.workflowSession = workflowSession;
    this.pendingWorkflow = null;
  }

  snapshot() {
    const proposal = this.proposalSession.snapshot();
    return {
      ...proposal,
      workflow: this.pendingWorkflow ? {
        id: this.pendingWorkflow.workflow.id,
        taskCount: this.pendingWorkflow.workflow.tasks.length,
        assetWriteCount: this.pendingWorkflow.persistContext?.assetWrites?.length ?? 0,
      } : null,
    };
  }

  async execute(workflow, options = {}) {
    const result = await this.workflowSession.execute(workflow, options);
    this.proposalSession.adopt(result.plan);
    this.pendingWorkflow = result;
    return this.snapshot();
  }

  select(operationIndexes, options = {}) {
    const state = this.proposalSession.select(operationIndexes, options);
    return { ...state, workflow: this.snapshot().workflow };
  }

  discard() {
    const plan = this.proposalSession.discard();
    const workflow = this.pendingWorkflow;
    this.pendingWorkflow = null;
    return { plan, workflow };
  }

  async apply(options = {}) {
    if (!this.pendingWorkflow) throw new Error('No executed Agent workflow is pending');
    const workflow = this.pendingWorkflow;
    const result = await this.proposalSession.apply({ ...options, persistContext: workflow.persistContext });
    this.pendingWorkflow = null;
    return { ...result, workflow };
  }
}
