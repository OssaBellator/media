import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserGpuCompositionRenderer } from '../gpu-composition-renderer.js';

test('GPU renderer forwards fidelity to graph resolution',async()=>{
  let resolvedOptions=null,submitted=0;
  const renderer=new BrowserGpuCompositionRenderer({navigatorObject:{gpu:{}}});
  renderer.device={createCommandEncoder:()=>({finish:()=>({})}),queue:{submit(){submitted++;}}};
  renderer.targetFor=async()=>({context:{getCurrentTexture:()=>({createView:()=>({})})},compositor:{async resolve(_plan,options){resolvedOptions=options;return[];},renderResolved(){return{backend:'webgpu-graph'};}}});
  const plan={visual:[{kind:'clip',assetId:'a',effects:[]}]};
  const fidelity={vectorSupersample:4,temporalSamples:1};
  const result=await renderer.present({},plan,{assetResolver:()=>({id:'a'}),frameProvider:{get:async()=>({width:1,height:1})},fidelity});
  assert.equal(resolvedOptions.fidelity,fidelity);
  assert.equal(result.backend,'webgpu-graph');
  assert.equal(submitted,1);
});
