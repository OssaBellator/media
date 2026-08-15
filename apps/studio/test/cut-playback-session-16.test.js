import test from 'node:test';
import assert from 'node:assert/strict';
import { CutPlaybackSession, cutPlaybackFrameKey } from '../cut-playback-session.js';

function harness(){
  const calls=[],composition={invalidations:0,fallbacks:0,closed:0,invalidate(){this.invalidations++;},showFallback(){this.fallbacks++;},stats(){return{presented:3};},close(){this.closed++;}},video={clears:0,assets:[],closed:0,clear(){this.clears++;},clearAsset(id){this.assets.push(id);},stats(){return{sources:2};},close(){this.closed++;}},fidelity={resets:0,async present(graph,time,options){calls.push({graph,time,options});return{backend:'canvas2d'};},reset(){this.resets++;}};
  return{session:new CutPlaybackSession({fidelityEngine:fidelity,compositionEngine:composition,videoEngine:video}),calls,composition,video,fidelity};
}

test('frame key follows explicit revision, mode and millisecond time',()=>{
  assert.equal(cutPlaybackFrameKey({projectId:'p',revision:4,time:1.2344,mode:'scrub'}),'p:4:scrub:1234');
  assert.notEqual(cutPlaybackFrameKey({projectId:'p',revision:4,time:1.2344,mode:'scrub'}),cutPlaybackFrameKey({projectId:'p',revision:5,time:1.2344,mode:'scrub'}));
});

test('immutable graph identity participates in session deduplication',async()=>{
  const {session,calls}=harness(),container={},first={projectId:'p',version:1},second={...first};
  await session.present(first,1,{container,mode:'playback'});await session.present(second,1,{container,mode:'playback'});
  assert.equal(calls.length,2);
});

test('session deduplicates identical presentation requests',async()=>{
  const {session,calls}=harness(),graph={projectId:'p',version:1},container={};
  await session.present(graph,1,{container,mode:'playback'});
  const second=await session.present(graph,1,{container,mode:'playback'});
  assert.equal(calls.length,1);assert.equal(second.deduped,true);assert.equal(session.stats().deduped,1);
});

test('new scrub aborts older interactive work',async()=>{
  let release,firstSignal;
  const composition={invalidate(){},showFallback(){},close(){}},video={close(){}},fidelity={reset(){},present(_g,time,{signal}){if(time===1){firstSignal=signal;return new Promise((resolve,reject)=>{release={resolve,reject};signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});}return Promise.resolve({backend:'ok'});}};
  const session=new CutPlaybackSession({fidelityEngine:fidelity,compositionEngine:composition,videoEngine:video}),graph={projectId:'p',version:1};
  const first=session.present(graph,1,{container:{},mode:'scrub'});
  await session.present(graph,2,{container:{},mode:'scrub'});
  assert.equal(firstSignal.aborted,true);await assert.rejects(first,(error)=>error.name==='AbortError');assert.equal(session.stats().cancelled,1);
  release?.resolve?.();
});

test('graph invalidation resets fidelity without discarding sources by default',()=>{
  const {session,composition,video,fidelity}=harness();session.invalidate();
  assert.equal(composition.invalidations,1);assert.equal(fidelity.resets,1);assert.equal(video.clears,0);
});

test('source invalidation clears decode state and asset invalidation is targeted',()=>{
  const {session,video}=harness();session.invalidate({sources:true});session.invalidateAsset('a');
  assert.equal(video.clears,1);assert.deepEqual(video.assets,['a']);assert.equal(session.stats().sourceInvalidations,2);
});

test('render failure restores fallback and clears dedup key',async()=>{
  const {session,composition,fidelity}=harness();fidelity.present=async()=>{throw new Error('decode failed');};
  await assert.rejects(()=>session.present({projectId:'p',version:1},0,{container:{},mode:'playback'}),/decode failed/);
  assert.equal(composition.fallbacks,1);assert.equal(session.stats().failures,1);
});

test('close is idempotent and rejects future work',async()=>{
  const {session,composition,video}=harness();session.close();session.close();
  assert.equal(composition.closed,1);assert.equal(video.closed,1);
  await assert.rejects(()=>session.present({projectId:'p',version:1},0,{container:{}}),/closed/);
});
