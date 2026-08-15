import test from 'node:test';
import assert from 'node:assert/strict';
import { rasterizeVectorMaskCanvas, vectorMaskRasterPlan } from '../vector-mask-raster.js';

function fakeCanvas(width,height){const data=new Uint8ClampedArray(width*height*4),context={createImageData:()=>({data:new Uint8ClampedArray(width*height*4),width,height}),putImageData(image){data.set(image.data);}};return{width,height,data,getContext:()=>context};}

test('vector mask raster plan consumes adaptive supersample',()=>{
  const plan=vectorMaskRasterPlan({paths:[[[0,0],[4,0],[4,4],[0,4]]],feather:1,invert:true,opacity:.5},{width:4,height:4,fidelity:{vectorSupersample:3}});
  assert.equal(plan.supersample,3);
  assert.equal(plan.feather,1);
  assert.equal(plan.invert,true);
  assert.equal(plan.opacity,.5);
});

test('vector mask canvas materializes alpha and neutralizes baked controls',()=>{
  const result=rasterizeVectorMaskCanvas({paths:[[[0,0],[3,0],[3,3],[0,3]]],feather:1,invert:true,opacity:.75},{width:4,height:4,fidelity:{vectorSupersample:4},canvasFactory:fakeCanvas});
  assert.equal(result.plan.supersample,4);
  assert.equal(result.canvas.data.length,64);
  assert.equal(result.effectiveMask.invert,false);
  assert.equal(result.effectiveMask.feather,0);
  assert.equal(result.effectiveMask.opacity,.75);
  assert.ok(result.matte.alpha.some((value)=>value>0&&value<255));
});
