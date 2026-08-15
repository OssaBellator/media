import test from 'node:test';
import assert from 'node:assert/strict';
import { installCutPlaybackBridge } from '../cut-playback-runtime.js';

class Target extends EventTarget { dispatch(name,detail){this.dispatchEvent(new CustomEvent(name,{detail}));} }

test('bridge exposes direct app API and forwards graph/time events',async()=>{
  const calls=[],runtime={present:async(...args)=>{calls.push(['present',...args]);return{backend:'ok'};},invalidate:(options)=>calls.push(['invalidate',options]),invalidateAsset:(id)=>calls.push(['asset',id]),stats:()=>({requests:1})},target=new Target(),cleanup=installCutPlaybackBridge(runtime,{target}),graph={projectId:'p'},container={};
  assert.equal(typeof target.mediaCutPlayback.present,'function');
  await target.mediaCutPlayback.present(graph,1,{container});
  target.dispatch('media:cut-present',{graph,time:2,mode:'playback',container});
  target.dispatch('media:graph-invalidated',{sources:true});
  target.dispatch('media:asset-relinked',{assetId:'a'});
  await new Promise((resolve)=>setTimeout(resolve,0));
  assert.equal(calls.filter((entry)=>entry[0]==='present').length,2);
  assert.deepEqual(calls.find((entry)=>entry[0]==='invalidate')[1],{sources:true});
  assert.deepEqual(calls.find((entry)=>entry[0]==='asset'),['asset','a']);
  assert.equal(target.mediaCutPlayback.stats().requests,1);
  cleanup();assert.equal(target.mediaCutPlayback,undefined);
});

test('production factory returns one session with inspectable owned resources',async()=>{
  const {createCutPlaybackRuntime}=await import('../cut-playback-runtime.js');
  const runtime=createCutPlaybackRuntime({blobResolver:async()=>new Blob()});
  assert.ok(runtime.resources.videoEngine);assert.ok(runtime.resources.compositionEngine);assert.ok(runtime.resources.fidelityEngine);assert.equal(typeof runtime.invalidateAsset,'function');runtime.close();
});
