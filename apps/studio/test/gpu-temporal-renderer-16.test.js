import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserGpuCompositionRenderer } from '../gpu-composition-renderer.js';

function fakeAccumulator(events){return{samples:0,begin(w,h){events.push(['begin',w,h]);this.samples=0;return this;},scratchView(){return{scratch:true};},add(_encoder,sourceTexture,weight){events.push(['add',sourceTexture.name,weight]);this.samples++;},finalize(_encoder,_view,options){events.push(['finalize',this.samples,options.toneMap?.method??null,options.sourcePeakNits]);return{samples:this.samples,workingFormat:'rgba16float',toneMap:options.toneMap??null,sourcePeakNits:options.sourcePeakNits};},clear(){events.push(['clear-acc']);}};}
function fakeCompositor(events,providers){const compositor={targets:{a:{name:'a'},b:{name:'b'}},async resolve(plan,options){events.push(['resolve',plan.time,options.fidelity.temporalSample.index,plan.visual[0].mask?.assetId??null]);providers.push(options.frameProvider);return plan.visual.map((item)=>({item,image:{kind:'linear-rgba16',sourcePeakNits:800+options.fidelity.temporalSample.index*200}}));},renderResolved(_encoder,targetView,plan,layers){events.push(['render',plan.time,layers.length,targetView.scratch]);return{backend:'webgpu-graph',layers:layers.length};},clear(){events.push(['clear-comp']);}};return compositor;}
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
  const additions=events.filter(([kind])=>kind==='add'),weights=additions.map(([,source,weight])=>weight);assert.ok(additions.every(([,source])=>source==='b'));
  assert.ok(Math.abs(weights.reduce((a,b)=>a+b,0)-1)<1e-9);assert.equal(submitted.length,4);
  const resolves=events.filter(([kind])=>kind==='resolve');assert.equal(resolves.length,3);assert.deepEqual(resolves.map((entry)=>entry[2]),[0,1,2]);
  assert.ok(resolves.every((entry)=>String(entry[3]).startsWith('__media_vector_mask_')));
  assert.equal(new Set(providers).size,3);
  assert.equal(result.vectorMasks,3);assert.equal(result.sourcePeakNits,1200);assert.deepEqual(events.at(-1),['finalize',3,null,1200]);
});
test('GPU temporal renderer accumulates HDR working textures before applying tone map once',async()=>{
  const events=[],providers=[],renderer=new BrowserGpuCompositionRenderer({navigatorObject:{gpu:{}},toneMap:{method:'aces',targetPeakNits:300}});
  renderer.device={createCommandEncoder:encoder,queue:{submit(){}}};renderer.format='bgra8unorm';
  renderer.targetFor=async()=>({context:{getCurrentTexture(){return{createView(){return{};}};}},compositor:{},temporalCompositor:fakeCompositor(events,providers),temporalAccumulator:fakeAccumulator(events)});
  const evaluated={compositionId:'c',time:0,fps:30,width:2,height:2,motionBlur:{enabled:true},visual:[{kind:'clip',assetId:'a',transform:{},effects:[]}]},asset={id:'a',props:{mediaKind:'video'}};
  const result=await renderer.presentTemporal({}, {nodes:{a:asset}}, evaluated,{evaluate(_g,{time}){return{...evaluated,time};},assetResolver:()=>asset,frameProvider:{get:async()=>({})},fidelity:{temporalSamples:2},shouldCommit:()=>true});
  assert.equal(result.toneMap.method,'aces');assert.equal(result.sourcePeakNits,1000);
  assert.deepEqual(events.at(-1),['finalize',2,'aces',1000]);
});

test('GPU temporal renderer selects the compositor working target by resolved-layer parity',async()=>{
  const events=[],providers=[],renderer=new BrowserGpuCompositionRenderer({navigatorObject:{gpu:{}}});
  renderer.device={createCommandEncoder:encoder,queue:{submit(){}}};renderer.format='bgra8unorm';
  renderer.targetFor=async()=>({context:{getCurrentTexture(){return{createView(){return{};}};}},compositor:{},temporalCompositor:fakeCompositor(events,providers),temporalAccumulator:fakeAccumulator(events)});
  const evaluated={compositionId:'c',time:0,fps:30,width:2,height:2,motionBlur:{enabled:true},visual:[{kind:'clip',assetId:'a',transform:{},effects:[]},{kind:'clip',assetId:'b',transform:{},effects:[]}]},assets={a:{id:'a',props:{mediaKind:'video'}},b:{id:'b',props:{mediaKind:'video'}}};
  await renderer.presentTemporal({}, {nodes:assets}, evaluated,{evaluate(_g,{time}){return{...evaluated,time};},assetResolver:(id)=>assets[id],frameProvider:{get:async()=>({})},fidelity:{temporalSamples:2},shouldCommit:()=>true});
  const additions=events.filter(([kind])=>kind==='add');assert.equal(additions.length,2);assert.ok(additions.every(([,source])=>source==='a'));
});
test('clear releases temporal compositor and accumulator alongside the normal target',()=>{
  const events=[],renderer=new BrowserGpuCompositionRenderer({navigatorObject:{gpu:{}}}),target={compositor:{clear(){events.push('clear-normal');}},temporalCompositor:{clear(){events.push('clear-temporal');}},temporalAccumulator:{clear(){events.push('clear-acc');}},context:{unconfigure(){events.push('unconfigure');}}};
  renderer.targetSet.add(target);renderer.clear();assert.deepEqual(events,['clear-normal','clear-temporal','clear-acc','unconfigure']);
});
