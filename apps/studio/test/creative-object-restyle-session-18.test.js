import test from 'node:test';
import assert from 'node:assert/strict';
import { CreativeObjectRestyleSession, MAX_RESTYLE_MODEL_CONTEXT_NODES } from '../creative-object-restyle-session.js';

function proposalStub({ adoptError = null } = {}) {
  let plan = null;
  const calls = { adopt: 0, apply: 0, discard: 0, persistContext: null };
  return {
    calls,
    snapshot() { return plan ? { status: 'pending', plan, review: { operations: plan.operations }, error: null } : { status: 'idle', plan: null, review: null, error: null }; },
    adopt(value) { calls.adopt += 1; if (adoptError) throw adoptError; plan = value; return this.snapshot(); },
    discard() { calls.discard += 1; const value = plan; plan = null; return value; },
    async apply(options = {}) { calls.apply += 1; calls.persistContext = options.persistContext; const value = plan; plan = null; return { plan: value, result: { committed: true } }; },
  };
}

function dependencies({ failOn = null, adoptError = null } = {}) {
  const graph = { projectId: 'p1', nodes: { img: { id: 'img', kind: 'asset', props: { mediaKind: 'image' } }, vid: { id: 'vid', kind: 'asset', props: { mediaKind: 'video' } } } };
  const representations = [
    { assetId: 'img', relationshipTargetIds: ['img', ...Array.from({ length: 30 }, (_, i) => `rel-${i}`)] },
    { assetId: 'vid', relationshipTargetIds: ['vid'] },
  ];
  const generationCalls = [];
  const preparedCalls = [];
  const proposal = proposalStub({ adoptError });
  const runGeneration = async (router, base, options) => {
    generationCalls.push(options);
    if (options.sourceNodeIds[0] === failOn) throw new Error(`generation failed for ${failOn}`);
    const assetId = `new-${options.sourceNodeIds[0]}`;
    return {
      backendId: options.operation === 'edit-image' ? 'image-model' : 'video-model',
      generation: { id: `gen-${assetId}`, operation: options.operation, sourceNodeIds: options.sourceNodeIds, backendId: 'model', createdAt: '2026-01-01T00:00:00Z', parentPlanId: options.parentPlanId },
      asset: { id: assetId, kind: 'asset' },
      operations: [],
      payload: new Uint8Array([1, 2, 3]),
    };
  };
  const preparePersistence = (routed) => {
    preparedCalls.push(routed.asset.id);
    return { asset: routed.asset, operations: [{ type: 'node.add', node: routed.asset }], persistContext: { assetWrites: [{ assetId: routed.asset.id, blob: { size: 3 } }] } };
  };
  const createPlan = (base, options) => ({
    plan: {
      id: options.id,
      operations: [
        { type: 'node.add', node: { id: 'new-img' } },
        { type: 'node.add', node: { id: 'new-vid' } },
        { type: 'node.update', nodeId: options.objectId, patch: {} },
      ],
      metadata: { creativeObjectRestyle: { objectId: options.objectId, atomic: true }, ...options.metadata },
    },
  });
  const session = new CreativeObjectRestyleSession({
    router: { execute() {} },
    getGraph: () => graph,
    proposalSession: proposal,
    resolveRepresentations: () => representations,
    operationForAsset: (asset) => asset.props.mediaKind === 'image' ? 'edit-image' : 'edit-video',
    runGeneration,
    preparePersistence,
    createPlan,
    createPlanId: () => 'agent-plan-restyle',
  });
  return { session, proposal, generationCalls, preparedCalls, graph };
}

test('stages every representation before adopting one reviewable plan and persists nothing yet', async () => {
  const value = dependencies();
  const state = await value.session.stage('object-1', 'make it neon');
  assert.equal(value.generationCalls.length, 2);
  assert.equal(value.proposal.calls.adopt, 1);
  assert.equal(value.proposal.calls.apply, 0);
  assert.equal(state.restyle.representationCount, 2);
  assert.equal(state.restyle.assetWriteCount, 2);
  assert.deepEqual(state.restyle.backendIds, ['image-model', 'video-model']);
  assert.ok(value.generationCalls[0].sourceNodeIds.length <= MAX_RESTYLE_MODEL_CONTEXT_NODES);
  assert.equal(value.generationCalls[0].sourceNodeIds[0], 'img');
  assert.deepEqual(value.generationCalls.map((call) => call.parentPlanId), ['agent-plan-restyle', 'agent-plan-restyle']);
  assert.ok(value.generationCalls.every((call) => call.creativeObjectIds[0] === 'object-1'));
});

test('generation failure leaves no adopted proposal or pending restyle', async () => {
  const value = dependencies({ failOn: 'vid' });
  await assert.rejects(() => value.session.stage('object-1', 'restyle'), /generation failed/);
  assert.equal(value.proposal.calls.adopt, 0);
  assert.equal(value.proposal.calls.apply, 0);
  assert.equal(value.session.hasPending(), false);
});

test('stale adoption failure leaves staged bytes uncommitted and session idle', async () => {
  const error = Object.assign(new Error('stale'), { code: 'AGENT_PLAN_STALE' });
  const value = dependencies({ adoptError: error });
  await assert.rejects(() => value.session.stage('object-1', 'restyle'), /stale/);
  assert.equal(value.proposal.calls.adopt, 1);
  assert.equal(value.proposal.calls.apply, 0);
  assert.equal(value.session.hasPending(), false);
});

test('restyle review is atomic and rejects partial operation selection', async () => {
  const value = dependencies();
  await value.session.stage('object-1', 'restyle');
  assert.throws(() => value.session.select([0, 1]), /atomic/);
  assert.throws(() => value.session.select([0, 1, 1]), /duplicates/);
  assert.doesNotThrow(() => value.session.select([2, 0, 1]));
});

test('apply commits all staged asset writes through the proposal session', async () => {
  const value = dependencies();
  await value.session.stage('object-1', 'restyle');
  const result = await value.session.apply({ metadata: { reviewSurface: 'studio' } });
  assert.equal(value.proposal.calls.apply, 1);
  assert.deepEqual(value.proposal.calls.persistContext.assetWrites.map((write) => write.assetId), ['new-img', 'new-vid']);
  assert.equal(result.restyle.planId, 'agent-plan-restyle');
  assert.equal(value.session.hasPending(), false);
});

test('discard clears the staged proposal without committing generated bytes', async () => {
  const value = dependencies();
  await value.session.stage('object-1', 'restyle');
  const discarded = value.session.discard();
  assert.equal(discarded.restyle.planId, 'agent-plan-restyle');
  assert.equal(value.proposal.calls.discard, 1);
  assert.equal(value.proposal.calls.apply, 0);
  assert.equal(value.session.hasPending(), false);
});
