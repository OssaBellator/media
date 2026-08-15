import test from 'node:test';
import assert from 'node:assert/strict';
import { CompositionFrameRenderer } from '../composition-frame-renderer.js';
import { renderCompositionTimelineExport } from '../composition-export.js';

function pixelCanvas(){let width=1,height=1,data=new Uint8ClampedArray(4);return{dataset:{},style:{},get width(){return width;},set width(v){width=v;data=new Uint8ClampedArray(width*height*4);},get height(){return height;},set height(v){height=v;data=new Uint8ClampedArray(width*height*4);},get data(){return data;},getContext(){return{clearRect(){data.fill(0);},drawImage(source){data=new Uint8ClampedArray(source.data??data);},getImageData(){return{data:new Uint8ClampedArray(data)};},createImageData(w,h){return{data:new Uint8ClampedArray(w*h*4)};},putImageData(image){data=new Uint8ClampedArray(image.data);}};}};}

test('composition frame renderer executes export temporal fidelity and exact output size',async()=>{
  let renders=0;
  const evaluated={compositionId:'c',time:0,fps:24,width:2,height:2,motionBlur:{enabled:true,shutterAngle:180},visual:[{assetId:'a'}],audio:[]};
  const renderer=new CompositionFrameRenderer({frameProvider:{},canvasFactory:pixelCanvas,evaluate:(_g,{time})=>({...evaluated,time}),scalePlan:(p)=>({...p,width:2,height:2}),renderer:async(canvas)=>{canvas.width=2;canvas.height=2;const value=[0,80,160,240][renders++];for(let i=0;i<canvas.data.length;i+=4)canvas.data.set([value,value,value,255],i);return{errors:[]};}});
  const result=await renderer.render({nodes:{a:{id:'a'}}},1,{width:4,height:3,fidelity:{mode:'export',fps:24,temporalSamples:4,vectorSupersample:4,resolutionScale:1}});
  assert.equal(renders,4);
  assert.equal(result.temporal,true);
  assert.equal(result.canvas.width,4);
  assert.equal(result.canvas.height,3);
});

test('composition export wrapper injects graph-backed renderFrame and export fidelity',async()=>{
  let captured=null,frameCalls=0;
  const frameRenderer={async frameAt(graph,time,options){frameCalls++;assert.equal(graph.nodes.c.id,'c');assert.equal(options.fidelity.mode,'export');assert.equal(options.fidelity.temporalSamples,6);assert.equal(options.fidelity.vectorSupersample,3);return{time};}};
  const result=await renderCompositionTimelineExport({graph:{nodes:{c:{id:'c'}}},compositionId:'c',manifest:{settings:{fps:30,width:1920,height:1080}},frameProvider:{},frameRenderer,temporalSamples:6,vectorSupersample:3,exporter:async(options)=>{captured=options;return{frame:await options.renderFrame(2)};},container:'mp4'});
  assert.equal(frameCalls,1);
  assert.equal(captured.container,'mp4');
  assert.equal(result.frame.time,2);
});
