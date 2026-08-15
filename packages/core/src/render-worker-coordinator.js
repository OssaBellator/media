import { canonicalOperationLogJson } from './operation-log.js';
import {
  RENDER_WORKER_MESSAGE_SCHEMA,
  RenderWorkerAuthError,
  claimAuthenticatedRenderChunk,
  completeAuthenticatedRenderChunk,
  renderWorkerSigningText,
  validateRenderWorkerMessage,
} from './render-worker-auth.js';
import { TrustedTransitionSession } from './trusted-transition.js';

function clone(value) { return value === undefined ? undefined : structuredClone(value); }
function validateJobs(jobs) {
  if (!jobs || typeof jobs !== 'object' || Array.isArray(jobs)) throw new RenderWorkerAuthError('Render worker coordinator jobs must be an object', { code: 'ERR_RENDER_WORKER_COORDINATOR_CONFIG' });
  for (const [jobId, job] of Object.entries(jobs)) {
    if (!job || typeof job !== 'object' || Array.isArray(job) || job.id !== jobId || typeof job.signature !== 'string' || !job.signature || !Array.isArray(job.chunks)) {
      throw new RenderWorkerAuthError(`Render worker coordinator job is invalid: ${jobId}`, { code: 'ERR_RENDER_WORKER_COORDINATOR_CONFIG' });
    }
  }
  return jobs;
}
function verificationContext(message) {
  validateRenderWorkerMessage(message, { requireSignature: true });
  const text = renderWorkerSigningText(message);
  return {
    bytes: new TextEncoder().encode(text),
    text,
    statement: JSON.parse(text),
    signature: message.signature,
    actor: clone(message.actor),
    type: message.type,
  };
}
function missingJob(message) {
  return new RenderWorkerAuthError(`Unknown render job: ${message.jobId}`, { code: 'ERR_RENDER_WORKER_JOB', actorId: message.actor.id, chunkId: message.chunk.id });
}

export class RenderWorkerCoordinatorSession {
  #session;
  #verifyArtifact;
  #now;

  constructor({
    trustRegistry,
    jobs = {},
    persist,
    verifySignature,
    verifyArtifact = null,
    now = () => Date.now(),
    maxAgeMs = 5 * 60 * 1000,
    maxFutureSkewMs = 0,
    nonceRetentionMs = 24 * 60 * 60 * 1000,
    maxNonceEntries = 10000,
  } = {}) {
    validateJobs(jobs);
    if (typeof persist !== 'function') throw new RenderWorkerAuthError('Render worker coordinator requires atomic persist callback', { code: 'ERR_RENDER_WORKER_COORDINATOR_CONFIG' });
    if (typeof verifySignature !== 'function') throw new RenderWorkerAuthError('Render worker coordinator requires signature verifier', { code: 'ERR_RENDER_WORKER_SIGNATURE' });
    if (verifyArtifact != null && typeof verifyArtifact !== 'function') throw new RenderWorkerAuthError('Render worker coordinator artifact verifier must be a function', { code: 'ERR_RENDER_WORKER_COORDINATOR_CONFIG' });
    if (typeof now !== 'function') throw new RenderWorkerAuthError('Render worker coordinator now must be a function', { code: 'ERR_RENDER_WORKER_COORDINATOR_CONFIG' });
    this.#verifyArtifact = verifyArtifact;
    this.#now = now;
    this.#session = new TrustedTransitionSession({
      trustRegistry,
      state: { jobs: clone(jobs) },
      verifySignature,
      now,
      policy: {
        purpose: 'render-worker',
        schema: RENDER_WORKER_MESSAGE_SCHEMA,
        types: ['claim', 'complete'],
        maxAgeMs,
        maxFutureSkewMs,
        requireNonce: true,
        nonceRetentionMs,
        maxNonceEntries,
      },
      persist: async ({ trustRegistry: nextTrust, state }, metadata) => {
        validateJobs(state.jobs);
        await persist({ trustRegistry: nextTrust, jobs: clone(state.jobs) }, metadata);
      },
    });
  }

  snapshot() {
    const value = this.#session.snapshot();
    return { trustRegistry: value.trustRegistry, jobs: value.state.jobs };
  }

  async submit(message) {
    const context = verificationContext(message);
    const outcome = await this.#session.process(context, async (state, { actor }) => {
      const job = state.jobs?.[message.jobId];
      if (!job) throw missingJob(message);
      const transitionNow = Number(this.#now());
      if (message.type === 'claim') {
        const claimed = await claimAuthenticatedRenderChunk(job, message, { verifySignature: async () => true, maxAgeMs: null, now: transitionNow });
        return {
          state: { jobs: { ...state.jobs, [job.id]: claimed.job } },
          result: { type: 'claim', jobId: job.id, chunkId: claimed.chunk.id, index: claimed.chunk.index, attempt: claimed.chunk.attempts, actor: clone(actor) },
        };
      }
      const completed = await completeAuthenticatedRenderChunk(job, message, { verifySignature: async () => true, maxAgeMs: null, verifyArtifact: this.#verifyArtifact, now: transitionNow });
      return {
        state: { jobs: { ...state.jobs, [job.id]: completed } },
        result: { type: 'complete', jobId: job.id, chunkId: message.chunk.id, attempt: message.chunk.attempt, artifactIntegrity: message.artifactIntegrity, actor: clone(actor) },
      };
    }, { metadata: { type: `render-worker.${message.type}`, jobId: message.jobId, chunkId: message.chunk.id } });
    return { verified: outcome.verified, committed: outcome.committed, result: outcome.result, trustRegistry: outcome.trustRegistry, jobs: outcome.state.jobs };
  }
}
