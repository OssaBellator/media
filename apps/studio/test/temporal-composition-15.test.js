import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTemporalCompositionToCanvas2D } from '../temporal-composition-renderer.js';

function pixelCanvas(){let width=1,height=1,data=new Uint8ClampedArray(4);const canvas={get width(){return width;},set width(value){width=value;data=new Uint8ClampedArray(width*height*4);},get height(){return height;},set height(value){height=value;data=new Uint8ClampedArray(width*height*4);},get data(){return data;},getContext(){return{getImageData(){return{data:new Uint8ClampedArray(data)};},createImageData(w,h){return{data:new Uint8ClampedArray(w*h*4),width:w,height:h};},putImageData(image){data=new Uint8ClampedArray(image.data);}};}};return canvas;}

test('temporal renderer re-evaluates subframes and accumulates weighted pixels',async()=>{
  const times=[];let call=0;
  const evaluated={compositionId:'c',time:1,fps:30,width:1,height:1,motionBlur:{enabled:true,shutterAngle:180,phase:'centered',weightCurve:'box'},visual:[{}]};
  const target=pixelCanvas();
  const result=await renderTemporalCompositionToCanvas2D(target,{},evaluated,{
    fidelity:{temporalSamples:3,fps:30},
    evaluate(_graph,{time}){times.push(time);return{...evaluated,time};},
    renderer:async(canvas,plan)=>{canvas.width=1;canvas.height=1;const value=[0,120,240][call++];canvas.data.set([value,value,value,255]);return{errors:[],time:plan.time};},
    canvasFactory:pixelCanvas,
  });
  assert.equal(result.samples.length,3);
  assert.equal(times.length,2);
  assert.ok(result.samples.some((sample)=>sample.time===1));
  assert.equal(target.data[0],120);
  assert.equal(target.data[3],255);
  assert.equal(result.sampleResults.length,3);
});

test('temporal renderer honors abort before doing work',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(()=>renderTemporalCompositionToCanvas2D(pixelCanvas(),{}, {compositionId:'c',time:0,fps:30,width:1,height:1,motionBlur:{enabled:true,shutterAngle:180}}, {
    fidelity:{temporalSamples:2},signal:controller.signal,evaluate(){throw new Error('must not evaluate');},renderer(){throw new Error('must not render');},canvasFactory:pixelCanvas,
  }),(error)=>error.name==='AbortError');
});

test('temporal renderer refuses accidental single-sample use',async()=>{
  await assert.rejects(()=>renderTemporalCompositionToCanvas2D(pixelCanvas(),{}, {compositionId:'c',time:0,width:1,height:1,motionBlur:{enabled:false}}, {
    fidelity:{temporalSamples:8},evaluate(){},renderer(){},canvasFactory:pixelCanvas,
  }),/more than one sample/);
});
