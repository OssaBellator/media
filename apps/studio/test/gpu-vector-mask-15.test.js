import test from 'node:test';
import assert from 'node:assert/strict';
import { gpuVectorMaskSupport, prepareGpuVectorMaskPlan } from '../gpu-vector-mask-adapter.js';

const vectorMask={paths:[[[0,0],[100,0],[100,100],[0,100]]],feather:2,invert:true,opacity:.6};

test('GPU vector-mask adapter refuses intrinsic masks rather than misaligning UV space',()=>{
  const result=gpuVectorMaskSupport({visual:[{kind:'shape',mask:vectorMask}]});
  assert.equal(result.supported,false);
  assert.match(result.reason,/intrinsic-vector-mask/);
});

test('GPU vector-mask adapter materializes source-sized synthetic mask after source decode',async()=>{
  const calls=[];
  const source={id:'source',props:{mediaKind:'video'}};
  const frame={displayWidth:320,displayHeight:180,timestamp:1};
  const prepared=prepareGpuVectorMaskPlan({time:1,visual:[{nodeId:'clip',assetId:'source',mask:vectorMask}]},{
    fidelity:{vectorSupersample:3},assetResolver:(id)=>id==='source'?source:null,
    frameProvider:{async get(asset,time){calls.push(['source',asset.id,time]);return frame;}},
    rasterizer(mask,options){calls.push(['mask',options.width,options.height,options.fidelity.vectorSupersample,mask.feather,mask.invert]);return{canvas:{width:options.width,height:options.height}};},
  });
  assert.equal(prepared.vectorMasks,1);
  const adapted=prepared.plan.visual[0];
  assert.ok(adapted.mask.assetId.startsWith('__media_vector_mask_'));
  assert.equal(adapted.mask.invert,false);
  assert.equal(adapted.mask.feather,0);
  const decoded=await prepared.frameProvider.get(source,1,{});
  assert.equal(decoded,frame);
  const maskAsset=prepared.assetResolver(adapted.mask.assetId);
  const maskFrame=await prepared.frameProvider.get(maskAsset,1,{});
  assert.deepEqual([maskFrame.width,maskFrame.height],[320,180]);
  assert.deepEqual(calls.at(-1),['mask',320,180,3,2,true]);
});

test('GPU vector-mask synthetic identity changes with supersample and shape',()=>{
  const base={visual:[{nodeId:'clip',assetId:'source',mask:vectorMask}]},resolver=()=>({id:'source',props:{width:10,height:10}}),provider={get:async()=>({width:10,height:10})};
  const a=prepareGpuVectorMaskPlan(base,{assetResolver:resolver,frameProvider:provider,fidelity:{vectorSupersample:1}}).plan.visual[0].mask.assetId;
  const b=prepareGpuVectorMaskPlan(base,{assetResolver:resolver,frameProvider:provider,fidelity:{vectorSupersample:4}}).plan.visual[0].mask.assetId;
  const c=prepareGpuVectorMaskPlan({visual:[{nodeId:'clip',assetId:'source',mask:{...vectorMask,paths:[[[0,0],[5,0],[5,5]]]}}]},{assetResolver:resolver,frameProvider:provider,fidelity:{vectorSupersample:1}}).plan.visual[0].mask.assetId;
  assert.notEqual(a,b);assert.notEqual(a,c);
});
