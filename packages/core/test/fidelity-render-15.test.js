import test from 'node:test';
import assert from 'node:assert/strict';
import { fidelityRenderHints, motionBlurPolicyFromComposition, normalizeMotionBlurPolicy, shouldTemporalAccumulate, temporalSamplesForFidelity, vectorSupersampleForFidelity } from '../src/fidelity-render.js';

test('temporal fidelity does not invent motion blur',()=>{
  const plan={time:2,fps:24,motionBlur:{enabled:false,shutterAngle:180}};
  assert.equal(shouldTemporalAccumulate(plan,{temporalSamples:8}),false);
  assert.deepEqual(temporalSamplesForFidelity(plan,{temporalSamples:8}),[{index:0,alpha:.5,time:2,weight:1}]);
});

test('temporal fidelity executes explicit motion blur policy',()=>{
  const plan={time:1,fps:24,motionBlur:{enabled:true,shutterAngle:180,phase:'centered',weightCurve:'box'}};
  const samples=temporalSamplesForFidelity(plan,{fps:24,temporalSamples:4});
  assert.equal(samples.length,4);
  assert.ok(samples[0].time<1);
  assert.ok(samples.at(-1).time>1);
  assert.ok(Math.abs(samples.reduce((sum,s)=>sum+s.weight,0)-1)<1e-12);
});

test('zero shutter collapses temporal accumulation',()=>{
  assert.equal(shouldTemporalAccumulate({time:1,motionBlur:{enabled:true,shutterAngle:0}},{temporalSamples:8}),false);
});

test('vector supersample fidelity clamps to rasterizer capability',()=>{
  assert.equal(vectorSupersampleForFidelity({vectorSupersample:0}),1);
  assert.equal(vectorSupersampleForFidelity({vectorSupersample:3}),3);
  assert.equal(vectorSupersampleForFidelity({vectorSupersample:99}),4);
});

test('composition motion blur policy is normalized',()=>{
  const policy=motionBlurPolicyFromComposition({props:{motionBlurEnabled:true,shutterAngle:270,shutterPhase:'leading',motionBlurWeightCurve:'triangle'}});
  assert.deepEqual(policy,{enabled:true,shutterAngle:270,phase:'leading',weightCurve:'triangle'});
  assert.deepEqual(normalizeMotionBlurPolicy({enabled:true,shutterAngle:500,phase:'bogus',weightCurve:'bogus'}),{enabled:true,shutterAngle:360,phase:'centered',weightCurve:'box'});
});

test('fidelity render hints expose temporal and vector execution state',()=>{
  const hints=fidelityRenderHints({time:0,fps:30,motionBlur:{enabled:true,shutterAngle:180}},{mode:'playback',resolutionScale:.75,temporalSamples:3,vectorSupersample:2});
  assert.equal(hints.temporal,true);
  assert.equal(hints.temporalSamples.length,3);
  assert.equal(hints.vectorSupersample,2);
  assert.equal(hints.resolutionScale,.75);
});
