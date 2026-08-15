import test from 'node:test';
import assert from 'node:assert/strict';
import {CompositionPlaybackEngine} from '../composition-playback-engine.js';

function fakeCanvas(){return{width:0,height:0,style:{},dataset:{},getContext(){return{clearRect(){},drawImage(){}};}};}
function fakeContainer(){return{children:[],querySelector(selector){if(selector.includes('canvas[data-composition-playback'))return this.children.find((c)=>selector.includes(c.dataset.compositionPlayback))??null;return null;},querySelectorAll(){return this.children;},appendChild(value){this.children.push(value);}};}

test('pre-evaluated composition applies fidelity resolution scale without evaluating again',async()=>{
  let evaluations=0,scaleOptions=null,renderOptions=null;
  const evaluated={compositionId:'comp',time:2,width:1920,height:1080,visual:[{kind:'text',text:'x',style:{},transform:{}}],audio:[]};
  const engine=new CompositionPlaybackEngine({
    frameProvider:{clear(){}},
    evaluate:()=>{evaluations++;return evaluated;},
    scalePlan:(plan,options)=>{scaleOptions=options;return{...plan,width:800,height:450};},
    renderer:async(_canvas,_plan,options)=>{renderOptions=options;return{errors:[]};},
    canvasFactory:fakeCanvas,
    maxWidth:1600,maxHeight:900,maxPixels:1_500_000,
  });
  const fidelity={mode:'playback',resolutionScale:.5,temporalSamples:2,vectorSupersample:2};
  const result=await engine.presentEvaluated({nodes:{}},evaluated,fakeContainer(),{fidelity});
  assert.equal(evaluations,0);
  assert.equal(scaleOptions.maxWidth,800);
  assert.equal(scaleOptions.maxHeight,450);
  assert.equal(scaleOptions.maxPixels,375000);
  assert.equal(renderOptions.fidelity.temporalSamples,2);
  assert.equal(result.plan.fidelity.resolutionScale,.5);
  assert.equal(engine.stats().fidelity.resolutionScale,.5);
});

test('present remains backward compatible and evaluates exactly once',async()=>{
  let evaluations=0;
  const engine=new CompositionPlaybackEngine({frameProvider:{clear(){}},evaluate:()=>{evaluations++;return{compositionId:'c',width:100,height:100,visual:[],audio:[]};},scalePlan:(p)=>p,renderer:async()=>({}),canvasFactory:fakeCanvas});
  const result=await engine.present({nodes:{}},0,fakeContainer());
  assert.equal(evaluations,1);
  assert.equal(result.backend,'fallback');
});
