import test from 'node:test';
import assert from 'node:assert/strict';
import { OfflineAudioSession } from '../offline-audio-session.js';

const graph={nodes:{clip:{id:'clip',props:{audioAutomation:{gainDb:[{time:0,value:0}]}}}}},output={props:{loudnessTargetLufs:-14,maxTruePeakDbfs:-1,audioAutomation:{gainDb:[]}}};
function plan(){return{sampleRate:48000,sources:[{clipId:'clip',assetId:'a'},{clipId:'clip',assetId:'b'}]};}

test('offline session decodes every referenced asset and forwards automation',async()=>{
  const decoded=[],mixCalls=[];
  const session=new OfflineAudioSession({createPlan:plan,decodeAsset:async(_g,_p,id)=>{decoded.push(id);return{sampleRate:48000,channels:[new Float32Array(1)],length:1};},renderMix:(p,sources,options)=>{mixCalls.push({p,sources,options});return{sampleRate:48000,channels:[new Float32Array(1),new Float32Array(1)],length:1};},analyze:()=>({integratedLufs:-20}),normalize:(pcm)=>({buffer:pcm,after:{integratedLufs:-14},gainDb:6})});
  const result=await session.render(graph,output,{start:0,end:1});
  assert.deepEqual(decoded,['a','b']);assert.equal(mixCalls[0].sources.size,2);assert.ok(mixCalls[0].options.clipAutomation.clip);assert.equal(result.loudness.gainDb,6);assert.equal(session.stats().normalized,1);
});

test('offline session refuses silent source omission',async()=>{
  const session=new OfflineAudioSession({createPlan:plan,decodeAsset:async(_g,_p,id)=>id==='a'?{sampleRate:48000}:null,renderMix:()=>({})});
  await assert.rejects(()=>session.render(graph,{props:{}},{start:0,end:1}),/source b could not be decoded/);assert.equal(session.stats().failures,1);
});

test('empty audio plans return null without decoding',async()=>{
  let calls=0;const session=new OfflineAudioSession({createPlan:()=>({sources:[]}),decodeAsset:async()=>{calls++;},renderMix:()=>({})});
  assert.equal(await session.render(graph,{props:{}}),null);assert.equal(calls,0);
});

test('aborted audio render does not start plan work',async()=>{
  let planned=0;const controller=new AbortController();controller.abort();const session=new OfflineAudioSession({createPlan:()=>{planned++;return{sources:[]};},decodeAsset:async()=>null,renderMix:()=>({})});
  await assert.rejects(()=>session.render(graph,{props:{}},{signal:controller.signal}),(error)=>error.name==='AbortError');assert.equal(planned,0);
});
