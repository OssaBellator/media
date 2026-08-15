import test from 'node:test';
import assert from 'node:assert/strict';
import { CompositionPlaybackEngine } from '../composition-playback-engine.js';

function pixelCanvas(){let width=1,height=1,data=new Uint8ClampedArray(4);const canvas={dataset:{},style:{},get width(){return width;},set width(value){width=value;data=new Uint8ClampedArray(width*height*4);},get height(){return height;},set height(value){height=value;data=new Uint8ClampedArray(width*height*4);},get data(){return data;},getContext(type){if(type==='webgpu')return null;return{clearRect(){data.fill(0);},drawImage(source){data=new Uint8ClampedArray(source.data??data);},getImageData(){return{data:new Uint8ClampedArray(data)};},createImageData(w,h){return{data:new Uint8ClampedArray(w*h*4)};},putImageData(image){data=new Uint8ClampedArray(image.data);}};}};return canvas;}
function container(){const nodes=[];return{style:{},appendChild(node){nodes.push(node);},querySelector(selector){if(selector==='video')return null;const match=/composition-playback=\"([^\"]+)/.exec(selector);return nodes.find((node)=>node.dataset?.compositionPlayback===match?.[1])??null;},querySelectorAll(){return nodes;}};}
const evaluated={compositionId:'c',time:1,fps:30,width:2,height:2,background:'#000',motionBlur:{enabled:true,shutterAngle:180},visual:[{assetId:'a'}]};
test('temporal composition prefers GPU temporal renderer when explicitly available',async()=>{
  let gpuCalls=0,canvasCalls=0;
  const engine=new CompositionPlaybackEngine({
    frameProvider:{clear(){}},canvasFactory:pixelCanvas,scalePlan:(plan)=>plan,evaluate:()=>evaluated,
    renderer:async()=>{canvasCalls++;return{errors:[]};},
    temporalRenderer:async()=>{canvasCalls++;throw new Error('Canvas temporal should not run');},
    gpuRenderer:{supports:()=>true,async presentTemporal(_canvas,_graph,raw,options){gpuCalls++;assert.equal(raw.compositionId,evaluated.compositionId);assert.equal(raw.fidelity.temporalSamples,3);assert.equal(typeof options.evaluate,'function');return{backend:'webgpu-temporal',plan:raw,samples:[1,2,3]};},clear(){}},
  });
  const result=await engine.presentEvaluated({nodes:{a:{id:'a'}}},evaluated,container(),{fidelity:{temporalSamples:3,resolutionScale:1}});
  assert.equal(result.backend,'webgpu-temporal');assert.equal(gpuCalls,1);assert.equal(canvasCalls,0);
  assert.equal(engine.stats().gpu,1);assert.equal(engine.stats().temporal,1);assert.equal(engine.stats().temporalSamples,3);
});
test('temporal GPU failure falls back to deterministic Canvas temporal renderer',async()=>{
  let temporalCalls=0;
  const engine=new CompositionPlaybackEngine({
    frameProvider:{clear(){}},canvasFactory:pixelCanvas,scalePlan:(plan)=>plan,evaluate:()=>evaluated,renderer:async()=>({errors:[]}),
    temporalRenderer:async(canvas)=>{temporalCalls++;canvas.width=2;canvas.height=2;return{backend:'composition-canvas2d-temporal',canvas,samples:[1,2],errors:[]};},
    gpuRenderer:{supports:()=>true,async presentTemporal(){throw new Error('device lost');},clear(){}},
  });
  const result=await engine.presentEvaluated({nodes:{a:{id:'a'}}},evaluated,container(),{fidelity:{temporalSamples:2,resolutionScale:1}});
  assert.equal(result.backend,'composition-canvas2d-temporal');assert.equal(temporalCalls,1);assert.equal(engine.stats().canvas2d,1);assert.equal(engine.stats().gpu,0);
});
test('legacy GPU renderer without presentTemporal preserves Canvas temporal path',async()=>{
  let normalGpu=0,temporalCalls=0;
  const engine=new CompositionPlaybackEngine({
    frameProvider:{clear(){}},canvasFactory:pixelCanvas,scalePlan:(plan)=>plan,evaluate:()=>evaluated,renderer:async()=>({errors:[]}),
    temporalRenderer:async(canvas)=>{temporalCalls++;canvas.width=2;canvas.height=2;return{canvas,samples:[1,2,3],errors:[]};},
    gpuRenderer:{supports:()=>true,async present(){normalGpu++;return{};},clear(){}},
  });
  const result=await engine.presentEvaluated({nodes:{a:{id:'a'}}},evaluated,container(),{fidelity:{temporalSamples:3,resolutionScale:1}});
  assert.equal(result.backend,'composition-canvas2d-temporal');assert.equal(normalGpu,0);assert.equal(temporalCalls,1);
});
