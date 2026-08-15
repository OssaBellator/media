import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserGpuCompositionRenderer } from '../gpu-composition-renderer.js';

function fakeAccumulator(events){return{samples:0,begin(w,h){events.push(['begin',w,h]);this.samples=0;return this;},scratchView(){return{scratch:true};},add(_encoder,weight){events.push(['add',weight]);this.samples++;},finalize(_encoder,_view){events.push(['finalize',this.samples]);return{samples:this.samples,workingFormat:'rgba16float'};},clear(){events.push(['clear-acc']);}};}
function fakeCompositor(events,providers){return{async resolve(plan,options){events.push(['resolve',plan.time,options.fidelity.temporalSample.index,plan.visual[0].mask?.assetId??null]);providers.push(options.frameProvider);return plan.visual.map((item)=>({item}));},renderResolved(_encoder,targetView,plan,layers){events.push(['render',plan.time,layers.length,targetView.scratch]);return{backend:'webgpu-graph',layers:layers.length};},clear(){events.push(['clear-comp']);}};}
function encoder(){return{finish(){return{};}};}
test('GPU temporal renderer evaluates, adapts vector masks, weights and submits every shutter sample before one final pass',async()=>{
  const events=[],providers=[],submitted=[];
  const renderer=new BrowserGpuCompositionRenderer({navigatorObject:{gpu:{}}});
  renderer.device={createCommandEncoder:encoder,queue:{submit(items){submitted.push(items);}}};renderer.format='bgra8unorm';
  const target={context:{getCurrentTexture(){return{createView(){return{canvas:true};}};}},compositor:{},temporalCompositor:fakeCompositor(events,providers),temporalAccumulator:fakeAccumulator(events)};
  renderer.targetFor=async()=>target;
  const evaluated={compositionId:'c',time:1,fps:30,width:4,height:2,motionBlur:{enabled:true,shutterAngle:180},visual:[{kind:'clip',nodeId:'clip',assetId:'a',mask:{type:'vector',paths:[[[0,0],[1,0],[1,1]]]},transform:{},effects:[]}]};
  const asset={id:'a',props:{mediaKind:'video',width:4,height:2}},baseProvider={get:async()=>({width:4,height:2})};
  const result=await renderer.presentTemporal({}, {nodes:{a:asset}}, evaluated,{
    evaluate(_graph,{time}){return{...evaluated,time};},scalePlan:(plan)=>plan,assetResolver:(id)=>id==='a'?asset:null,frameProvider:baseProvider,fidelity:{temporalSamples:3,vectorSupersample:2},shouldCommit:()=>true,
  });
  assert.equal(result.backend,'webgpu-temporal');assert.equal(result.samples.length,3);assert.equal(result.sampleResults.length,3);
  const weights=events.filter(([kind])=>kind==='add').map(([,weight])=>weight);
  assert.ok(Math.abs(weights.reduce((a,b)=>a+b,0)-1)<1e-9);assert.equal(submitted.length,4);
  const resolves=events.filter(([kind])=>kind==='resolve');assert.equal(resolves.length,3);assert.deepEqual(resolves.map((entry)=>entry[2]),[0,1,2]);
  assert.ok(resolves.every((entry)=>String(entry[3]).startsWith('__media_vector_mask_')));
  assert.equal(new Set(providers).size,3);
  assert.equal(result.vectorMasks,3);assert.deepEqual(events.at(-1),['finalize',3]);
});
test('GPU temporal renderer refuses tone-mapped/HDR policy so caller can use Canvas fallback',async()=>{
  const renderer=new BrowserGpuCompositionRenderer({navigatorObject:{gpu:{}},toneMap:{method:'aces'}});
  await assert.rejects(()=>renderer.presentTemporal({}, {}, {time:0,fps:30,visual:[]},{evaluate:()=>({}),fidelity:{temporalSamples:2}}),/requires SDR output/);
});
test('clear releases temporal compositor and accumulator alongside the normal target',()=>{
  const events=[],renderer=new BrowserGpuCompositionRenderer({navigatorObject:{gpu:{}}}),target={compositor:{clear(){events.push('clear-normal');}},temporalCompositor:{clear(){events.push('clear-temporal');}},temporalAccumulator:{clear(){events.push('clear-acc');}},context:{unconfigure(){events.push('unconfigure');}}};
  renderer.targetSet.add(target);renderer.clear();assert.deepEqual(events,['clear-normal','clear-temporal','clear-acc','unconfigure']);
});
