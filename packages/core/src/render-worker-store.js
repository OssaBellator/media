import { canonicalOperationLogJson } from './operation-log.js';
import { validateTrustRegistry } from './trust-registry.js';
import { RenderWorkerCoordinatorSession } from './render-worker-coordinator.js';

export const RENDER_WORKER_COORDINATOR_STORE_SCHEMA = 'media.render-worker-coordinator-store.v1';

export class RenderWorkerCoordinatorStoreError extends Error {
  constructor(message, { code = 'ERR_RENDER_WORKER_STORE', expectedRevision = null, actualRevision = null, reloadRequired = false, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'RenderWorkerCoordinatorStoreError';
    this.code = code;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
    this.reloadRequired = reloadRequired;
  }
}

function clone(value) { return value === undefined ? undefined : JSON.parse(canonicalOperationLogJson(value)); }
function validateJobs(jobs) {
  if (!jobs || typeof jobs !== 'object' || Array.isArray(jobs)) throw new RenderWorkerCoordinatorStoreError('Render worker coordinator store jobs must be an object', { code: 'ERR_RENDER_WORKER_STORE_FORMAT' });
  for (const [jobId, job] of Object.entries(jobs)) {
    if (!job || typeof job !== 'object' || Array.isArray(job) || job.id !== jobId || typeof job.signature !== 'string' || !job.signature || !Array.isArray(job.chunks)) {
      throw new RenderWorkerCoordinatorStoreError(`Render worker coordinator store job is invalid: ${jobId}`, { code: 'ERR_RENDER_WORKER_STORE_FORMAT' });
    }
  }
  canonicalOperationLogJson(jobs);
  return jobs;
}
function revision(value, label = 'Render worker coordinator store revision') {
  if (!Number.isSafeInteger(value) || value < 0) throw new RenderWorkerCoordinatorStoreError(`${label} must be a non-negative safe integer`, { code: 'ERR_RENDER_WORKER_STORE_FORMAT' });
  return value;
}
export function validateRenderWorkerCoordinatorStoreSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new RenderWorkerCoordinatorStoreError('Render worker coordinator store snapshot must be an object', { code: 'ERR_RENDER_WORKER_STORE_FORMAT' });
  if (snapshot.schema !== RENDER_WORKER_COORDINATOR_STORE_SCHEMA) throw new RenderWorkerCoordinatorStoreError(`Unsupported render worker coordinator store schema: ${snapshot.schema}`, { code: 'ERR_RENDER_WORKER_STORE_FORMAT' });
  revision(snapshot.revision);
  validateTrustRegistry(snapshot.trustRegistry);
  validateJobs(snapshot.jobs);
  if (snapshot.savedAt != null && typeof snapshot.savedAt !== 'string') throw new RenderWorkerCoordinatorStoreError('Render worker coordinator store savedAt must be a string or null', { code: 'ERR_RENDER_WORKER_STORE_FORMAT' });
  canonicalOperationLogJson(snapshot);
  return snapshot;
}
export function createRenderWorkerCoordinatorStoreSnapshot({ trustRegistry, jobs = {}, revision: value = 0, savedAt = null } = {}) {
  if (trustRegistry == null) throw new RenderWorkerCoordinatorStoreError('Render worker coordinator store snapshot requires trustRegistry', { code: 'ERR_RENDER_WORKER_STORE_CONFIG' });
  const snapshot = { schema: RENDER_WORKER_COORDINATOR_STORE_SCHEMA, revision: revision(value), trustRegistry: clone(trustRegistry), jobs: clone(jobs), savedAt: savedAt == null ? null : String(savedAt) };
  validateRenderWorkerCoordinatorStoreSnapshot(snapshot);
  return snapshot;
}
function casResult(value, expectedNextRevision) {
  if (value === true) return { committed: true, currentRevision: expectedNextRevision };
  if (value === false) return { committed: false, currentRevision: null };
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.committed !== 'boolean') throw new RenderWorkerCoordinatorStoreError('Render worker coordinator compareAndSwap returned an invalid result', { code: 'ERR_RENDER_WORKER_STORE_PROTOCOL', reloadRequired: true });
  const currentRevision = value.currentRevision == null ? null : revision(value.currentRevision, 'Render worker coordinator store currentRevision');
  if (value.committed && currentRevision != null && currentRevision !== expectedNextRevision) throw new RenderWorkerCoordinatorStoreError('Render worker coordinator compareAndSwap committed an unexpected revision', { code: 'ERR_RENDER_WORKER_STORE_PROTOCOL', actualRevision: currentRevision, reloadRequired: true });
  return { committed: value.committed, currentRevision };
}

export class RenderWorkerCoordinatorStoreSession {
  #load;
  #compareAndSwap;
  #coordinatorOptions;
  #initialSnapshot;
  #snapshot = null;
  #coordinator = null;
  #reloadRequired = false;
  #tail = Promise.resolve();

  constructor({ load, compareAndSwap, initialTrustRegistry = null, initialJobs = {}, ...coordinatorOptions } = {}) {
    if (typeof load !== 'function') throw new RenderWorkerCoordinatorStoreError('Render worker coordinator store load callback is required', { code: 'ERR_RENDER_WORKER_STORE_CONFIG' });
    if (typeof compareAndSwap !== 'function') throw new RenderWorkerCoordinatorStoreError('Render worker coordinator store compareAndSwap callback is required', { code: 'ERR_RENDER_WORKER_STORE_CONFIG' });
    this.#load = load;
    this.#compareAndSwap = compareAndSwap;
    this.#coordinatorOptions = coordinatorOptions;
    this.#initialSnapshot = initialTrustRegistry == null ? null : createRenderWorkerCoordinatorStoreSnapshot({ trustRegistry: initialTrustRegistry, jobs: initialJobs, revision: 0 });
  }

  #serialize(fn) { const run = this.#tail.then(fn, fn); this.#tail = run.catch(() => {}); return run; }

  async #readSnapshot() {
    let value;
    try { value = await this.#load(); }
    catch (error) { throw new RenderWorkerCoordinatorStoreError('Render worker coordinator store load failed', { code: 'ERR_RENDER_WORKER_STORE_LOAD', reloadRequired: true, cause: error }); }
    if (value == null) {
      if (!this.#initialSnapshot) throw new RenderWorkerCoordinatorStoreError('Render worker coordinator store is empty and no initial trust registry was supplied', { code: 'ERR_RENDER_WORKER_STORE_BOOTSTRAP', reloadRequired: true });
      return clone(this.#initialSnapshot);
    }
    validateRenderWorkerCoordinatorStoreSnapshot(value);
    return clone(value);
  }

  #build(snapshot) {
    this.#snapshot = clone(snapshot);
    this.#reloadRequired = false;
    this.#coordinator = new RenderWorkerCoordinatorSession({
      ...this.#coordinatorOptions,
      trustRegistry: clone(snapshot.trustRegistry),
      jobs: clone(snapshot.jobs),
      persist: async ({ trustRegistry, jobs }, metadata) => {
        const expectedRevision = this.#snapshot.revision;
        const next = createRenderWorkerCoordinatorStoreSnapshot({ trustRegistry, jobs, revision: expectedRevision + 1, savedAt: new Date().toISOString() });
        let raw;
        try { raw = await this.#compareAndSwap({ expectedRevision, snapshot: clone(next), metadata: clone(metadata ?? {}) }); }
        catch (error) {
          this.#reloadRequired = true;
          throw new RenderWorkerCoordinatorStoreError('Render worker coordinator store commit state is unknown; reload before retrying any signed message', { code: 'ERR_RENDER_WORKER_STORE_UNKNOWN_COMMIT', expectedRevision, reloadRequired: true, cause: error });
        }
        let result;
        try { result = casResult(raw, next.revision); }
        catch (error) { this.#reloadRequired = true; throw error; }
        if (!result.committed) {
          this.#reloadRequired = true;
          throw new RenderWorkerCoordinatorStoreError(`Render worker coordinator store compare-and-swap expected revision ${expectedRevision}`, { code: 'ERR_RENDER_WORKER_STORE_CONFLICT', expectedRevision, actualRevision: result.currentRevision, reloadRequired: true });
        }
        this.#snapshot = clone(next);
      },
    });
  }

  reload() {
    return this.#serialize(async () => {
      const snapshot = await this.#readSnapshot();
      this.#build(snapshot);
      return this.snapshot();
    });
  }

  submit(message) {
    return this.#serialize(async () => {
      if (!this.#coordinator) throw new RenderWorkerCoordinatorStoreError('Render worker coordinator store session is not loaded', { code: 'ERR_RENDER_WORKER_STORE_NOT_LOADED', reloadRequired: true });
      if (this.#reloadRequired) throw new RenderWorkerCoordinatorStoreError('Render worker coordinator store session must reload before another signed message', { code: 'ERR_RENDER_WORKER_STORE_RELOAD_REQUIRED', expectedRevision: this.#snapshot?.revision ?? null, reloadRequired: true });
      const result = await this.#coordinator.submit(message);
      return { ...result, storeRevision: this.#snapshot.revision };
    });
  }

  snapshot() {
    if (!this.#coordinator || !this.#snapshot) return null;
    const current = this.#coordinator.snapshot();
    return { schema: RENDER_WORKER_COORDINATOR_STORE_SCHEMA, revision: this.#snapshot.revision, savedAt: this.#snapshot.savedAt, reloadRequired: this.#reloadRequired, trustRegistry: current.trustRegistry, jobs: current.jobs };
  }
}

export async function openRenderWorkerCoordinatorStoreSession(options = {}) {
  const session = new RenderWorkerCoordinatorStoreSession(options);
  await session.reload();
  return session;
}
