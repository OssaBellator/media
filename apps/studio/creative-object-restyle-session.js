import { createId } from '../../packages/core/src/id.js';
import { runGeneratedMediaModel } from '../../packages/core/src/generation-runner.js';
import {
  createCreativeObjectRestylePlan,
  resolveCreativeObjectRepresentations,
  restyleOperationForAsset,
} from '../../packages/core/src/object-restyle.js';
import { prepareGeneratedMediaPersistence } from './generated-media-commit-session.js';

export const MAX_RESTYLE_MODEL_CONTEXT_NODES = 16;

function requireFunction(value, label) {
  if (typeof value !== 'function') throw new Error(`${label} must be a function`);
  return value;
}
function requireProposalSession(session) {
  if (!session || typeof session.snapshot !== 'function' || typeof session.adopt !== 'function' || typeof session.apply !== 'function' || typeof session.discard !== 'function') throw new Error('Creative Object restyle requires a proposal session');
  return session;
}
function requireRouter(router) {
  if (!router || typeof router.execute !== 'function') throw new Error('Creative Object restyle requires a model router');
  return router;
}
function requireIntent(intent) {
  if (typeof intent !== 'string' || !intent.trim()) throw new Error('Creative Object restyle intent must be a non-empty string');
  return intent.trim();
}
function unique(values) {
  return [...new Set(values.map(String))];
}
function boundedContextNodeIds(representation) {
  const related = unique(representation.relationshipTargetIds ?? []).filter((id) => id !== representation.assetId).sort();
  return [representation.assetId, ...related.slice(0, MAX_RESTYLE_MODEL_CONTEXT_NODES - 1)];
}
function fullSelection(operationIndexes, count) {
  if (!Array.isArray(operationIndexes)) throw new Error('Creative Object restyle operation selection must be an array');
  const indexes = operationIndexes.map(Number);
  if (indexes.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= count)) throw new Error('Creative Object restyle operation selection is out of range');
  if (new Set(indexes).size !== indexes.length) throw new Error('Creative Object restyle operation selection contains duplicates');
  const sorted = indexes.slice().sort((a, b) => a - b);
  return sorted.length === count && sorted.every((value, index) => value === index);
}

export class CreativeObjectRestyleSession {
  constructor({
    router,
    getGraph,
    proposalSession,
    assetUri = (assetId) => `media://asset/${assetId}`,
    runGeneration = runGeneratedMediaModel,
    preparePersistence = prepareGeneratedMediaPersistence,
    resolveRepresentations = resolveCreativeObjectRepresentations,
    operationForAsset = restyleOperationForAsset,
    createPlan = createCreativeObjectRestylePlan,
    createPlanId = () => createId('agent-plan'),
  } = {}) {
    this.router = requireRouter(router);
    this.getGraph = requireFunction(getGraph, 'Creative Object restyle getGraph');
    this.proposalSession = requireProposalSession(proposalSession);
    this.assetUri = requireFunction(assetUri, 'Creative Object restyle assetUri');
    this.runGeneration = requireFunction(runGeneration, 'Creative Object restyle runGeneration');
    this.preparePersistence = requireFunction(preparePersistence, 'Creative Object restyle preparePersistence');
    this.resolveRepresentations = requireFunction(resolveRepresentations, 'Creative Object restyle resolveRepresentations');
    this.operationForAsset = requireFunction(operationForAsset, 'Creative Object restyle operationForAsset');
    this.createPlan = requireFunction(createPlan, 'Creative Object restyle createPlan');
    this.createPlanId = requireFunction(createPlanId, 'Creative Object restyle createPlanId');
    this.pending = null;
  }

  snapshot() {
    const proposal = this.proposalSession.snapshot();
    return {
      ...proposal,
      restyle: this.pending ? {
        objectId: this.pending.objectId,
        planId: this.pending.planId,
        representationCount: this.pending.representationCount,
        assetWriteCount: this.pending.persistContext.assetWrites.length,
        backendIds: [...this.pending.backendIds],
      } : null,
    };
  }

  hasPending() {
    return Boolean(this.pending);
  }

  #assertIdle() {
    const proposal = this.proposalSession.snapshot();
    if (this.pending || proposal.status !== 'idle') throw new Error('Review or discard the pending Agent proposal before staging a Creative Object restyle');
  }

  #assertPendingPlan() {
    if (!this.pending) throw new Error('No Creative Object restyle proposal is pending');
    const proposal = this.proposalSession.snapshot();
    if (!proposal.plan || proposal.plan.id !== this.pending.planId) throw new Error('Pending Creative Object restyle no longer matches the proposal session');
    return proposal;
  }

  async stage(objectId, intent, {
    settings = {},
    policy = {},
    context = {},
    signal,
    requestId = null,
    modelInput = {},
    maxRepresentations,
  } = {}) {
    this.#assertIdle();
    const cleanIntent = requireIntent(intent);
    const baseGraph = this.getGraph();
    const representations = this.resolveRepresentations(baseGraph, objectId, { ...(maxRepresentations == null ? {} : { maxRepresentations }) });
    if (!representations.length) throw new Error(`Creative Object ${objectId} has no media representations to restyle`);
    const planId = String(this.createPlanId());
    if (!planId) throw new Error('Creative Object restyle plan id must be non-empty');
    const replacements = [];
    const assetWrites = [];
    const backendIds = new Set();

    for (const representation of representations) {
      const sourceAsset = baseGraph.nodes?.[representation.assetId];
      const operation = this.operationForAsset(sourceAsset);
      const sourceNodeIds = boundedContextNodeIds(representation);
      const routed = await this.runGeneration(this.router, baseGraph, {
        operation,
        intent: cleanIntent,
        settings,
        sourceNodeIds,
        creativeObjectIds: [objectId],
        parentPlanId: planId,
        requestId,
        policy,
        context: { ...context, purpose: 'creative-object-restyle', objectId, sourceAssetId: representation.assetId },
        modelInput,
        signal,
      });
      const prepared = this.preparePersistence(routed, { assetUri: this.assetUri });
      replacements.push({
        sourceAssetId: representation.assetId,
        asset: prepared.asset,
        generation: routed.generation,
        operations: prepared.operations,
      });
      assetWrites.push(...(prepared.persistContext?.assetWrites ?? []));
      if (routed.backendId) backendIds.add(String(routed.backendId));
    }

    const materialized = this.createPlan(baseGraph, {
      id: planId,
      objectId,
      intent: cleanIntent,
      replacements,
      metadata: { restyleBackendIds: [...backendIds].sort() },
      ...(maxRepresentations == null ? {} : { maxRepresentations }),
    });
    this.proposalSession.adopt(materialized.plan);
    this.pending = {
      objectId,
      planId,
      representationCount: representations.length,
      backendIds: [...backendIds].sort(),
      persistContext: { assetWrites },
    };
    return this.snapshot();
  }

  select(operationIndexes) {
    const proposal = this.#assertPendingPlan();
    const count = proposal.plan.operations.length;
    if (!fullSelection(operationIndexes, count)) throw new Error('Creative Object restyle proposals are atomic across generated assets, provenance, and rewires');
    return this.snapshot();
  }

  discard() {
    this.#assertPendingPlan();
    const pending = this.pending;
    const plan = this.proposalSession.discard();
    this.pending = null;
    return { plan, restyle: pending };
  }

  async revise(intent, options = {}) {
    const pending = this.#assertPendingPlan();
    const objectId = pending.plan.metadata?.creativeObjectRestyle?.objectId ?? this.pending.objectId;
    this.proposalSession.discard();
    this.pending = null;
    return this.stage(objectId, intent, options);
  }

  async apply(options = {}) {
    this.#assertPendingPlan();
    const pending = this.pending;
    const result = await this.proposalSession.apply({ ...options, persistContext: pending.persistContext });
    this.pending = null;
    return { ...result, restyle: pending };
  }
}
