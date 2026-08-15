import test from 'node:test';
import assert from 'node:assert/strict';
import {FidelityController} from '../src/fidelity-scheduler.js';

test('scrub immediately uses minimum-cost preview fidelity',()=>{
  const controller=new FidelityController({scrubResolutionScale:.45,minResolutionScale:.4});
  assert.deepEqual(controller.plan({mode:'scrub',fps:60}),{mode:'scrub',fps:60,frameBudgetMs:1000/60,temporalSamples:1,vectorSupersample:1,resolutionScale:.45});
});

test('over-budget playback reduces preview resolution and reset restores neutral pressure',()=>{
  const controller=new FidelityController({utilization:.75,ewmaAlpha:.5,minResolutionScale:.5});
  controller.record({durationMs:50,stale:true});
  const degraded=controller.plan({mode:'playback',fps:30,requestedTemporalSamples:8,requestedVectorSupersample:4});
  assert.ok(degraded.resolutionScale<1);
  assert.ok(degraded.temporalSamples<8);
  assert.ok(degraded.stalePressure>0);
  controller.reset();
  const reset=controller.snapshot();
  assert.equal(reset.frames,0);
  assert.equal(reset.stalePressure,0);
});

test('export preserves requested quality and full resolution',()=>{
  const controller=new FidelityController();
  controller.record({durationMs:200,stale:true});
  const plan=controller.plan({mode:'export',fps:24,requestedTemporalSamples:12,requestedVectorSupersample:6});
  assert.equal(plan.temporalSamples,12);
  assert.equal(plan.vectorSupersample,6);
  assert.equal(plan.resolutionScale,1);
  assert.equal(plan.frameBudgetMs,Infinity);
});
