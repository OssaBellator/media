import { assertAgentWorkflow } from '../../packages/core/src/agent-workflow.js';

export const MAX_AGENT_DELEGATION_REVIEW_TASKS = 64;
export const MAX_AGENT_DELEGATION_REVIEW_ID_CHARS = 160;

function boundedReviewText(value, limit) {
  const text = String(value ?? '');
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`;
}

export function summarizeAgentDelegationWorkflow(workflow, { assetWriteCount = 0 } = {}) {
  assertAgentWorkflow(workflow);
  const tasks = workflow.tasks.slice(0, MAX_AGENT_DELEGATION_REVIEW_TASKS).map((task) => ({
    id: boundedReviewText(task.id, MAX_AGENT_DELEGATION_REVIEW_ID_CHARS),
    kind: task.kind,
    status: task.status,
    optional: task.optional === true,
    dependencyCount: task.dependsOn.length,
  }));
  return {
    id: boundedReviewText(workflow.id, MAX_AGENT_DELEGATION_REVIEW_ID_CHARS),
    taskCount: workflow.tasks.length,
    assetWriteCount: Math.max(0, Number(assetWriteCount) || 0),
    tasks,
    truncatedTaskCount: Math.max(0, workflow.tasks.length - tasks.length),
  };
}

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
      workflow: this.pendingWorkflow ? summarizeAgentDelegationWorkflow(this.pendingWorkflow.workflow, {
        assetWriteCount: this.pendingWorkflow.persistContext?.assetWrites?.length ?? 0,
      }) : null,
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
