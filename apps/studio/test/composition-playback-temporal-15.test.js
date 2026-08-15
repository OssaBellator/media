import test from 'node:test';
import assert from 'node:assert/strict';
import { CompositionPlaybackEngine } from '../composition-playback-engine.js';

function pixelCanvas(){let width=1,height=1,data=new Uint8ClampedArray(4);const canvas={dataset:{},style:{},get width(){return width;},set width(value){width=value;data=new Uint8ClampedArray(width*height*4);},get height(){return height;},set height(value){height=value;data=new Uint8ClampedArray(width*height*4);},get data(){return data;},getContext(){return{clearRect(){data.fill(0);},drawImage(source){data=new Uint8ClampedArray(source.data??data);},getImageData(){return{data:new Uint8ClampedArray(data)};},createImageData(w,h){return{data:new Uint8ClampedArray(w*h*4)};},putImageData(image){data=new Uint8ClampedArray(image.data);}};}};return canvas;}
function container(){const nodes=[];return{style:{},appendChild(node){nodes.push(node);},querySelector(selector){if(selector==='video')return null;const match=/composition-playback=\"([^\"]+)/.exec(selector);return nodes.find((node)=>node.dataset?.compositionPlayback===match?.[1])??null;},querySelectorAll(){return nodes;}};}

test('composition engine executes temporal fidelity for explicit motion blur',async()=>{
  const evalTimes=[];let renders=0,gpuCalls=0;
  const evaluated={compositionId:'c',time:1,fps:30,width:1,height:1,background:'#000',motionBlur:{enabled:true,shutterAngle:180},visual:[{assetId:'a'}]};
  const engine=new CompositionPlaybackEngine({
    frameProvider:{clear(){}},canvasFactory:pixelCanvas,scalePlan:(plan)=>plan,
    evaluate(_graph,{time}){evalTimes.push(time);return{...evaluated,time};},
    renderer:async(canvas)=>{canvas.width=1;canvas.height=1;const value=[0,120,240][renders++];canvas.data.set([value,value,value,255]);return{errors:[]};},
    gpuRenderer:{supports:()=>true,async present(){gpuCalls++;return{backend:'webgpu'};},clear(){}},
  });
  const result=await engine.presentEvaluated({nodes:{a:{id:'a'}}},evaluated,container(),{fidelity:{fps:30,temporalSamples:3,vectorSupersample:2,resolutionScale:1}});
  assert.equal(result.backend,'composition-canvas2d-temporal');
  assert.equal(result.samples.length,3);
  assert.equal(gpuCalls,0);
  assert.equal(evalTimes.length,2);
  assert.equal(engine.stats().temporal,1);
  assert.equal(engine.stats().temporalSamples,3);
});

test('composition engine retains GPU path when blur is not requested',async()=>{
  let gpuCalls=0;
  const evaluated={compositionId:'c',time:1,fps:30,width:1,height:1,background:'#000',motionBlur:{enabled:false},visual:[{assetId:'a'}]};
  const engine=new CompositionPlaybackEngine({frameProvider:{clear(){}},canvasFactory:pixelCanvas,scalePlan:(plan)=>plan,evaluate:()=>evaluated,renderer:async()=>({errors:[]}),gpuRenderer:{supports:()=>true,async present(){gpuCalls++;return{backend:'webgpu-graph'};},clear(){}}});
  const result=await engine.presentEvaluated({nodes:{a:{id:'a'}}},evaluated,container(),{fidelity:{temporalSamples:8,resolutionScale:1}});
  assert.equal(result.backend,'webgpu-graph');
  assert.equal(gpuCalls,1);
  assert.equal(engine.stats().temporal,0);
});
