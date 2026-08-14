import assert from 'node:assert/strict';
import test from 'node:test';
import { createDerivativeJob } from '../../../packages/core/src/derivative-jobs.js';
import { runSegmentedDerivative } from '../derivative-job-runner.js';

function memoryStorage(){const map=new Map();return{map,async load(k){return map.get(k)??null;},async save(k,v){map.set(k,structuredClone(v));return true;}};}

test('segmented derivative runner persists every completed segment and can resume', async () => {
  const storage=memoryStorage();let generated=[];
  const job=createDerivativeJob({assetId:'a',duration:6,segmentDuration:2,keyframes:[0,2,4,6]});
  const track={id:'v'};const chunks=[0,1,2,3,4,5].map((s)=>({trackId:'v',type:'key',timestamp:s*1_000_000,duration:1_000_000,offset:s,byteLength:1,sequence:s}));
  const complete=await runSegmentedDerivative({job,track,chunks,sourceBytes:new Uint8Array(6),storage,generateSegment:async({segment,chunks,sourceBytes})=>{generated.push(segment.index);assert.equal(chunks[0].offset,0);assert.equal(sourceBytes.byteLength,chunks.reduce((sum,c)=>sum+c.byteLength,0));return{bytes:new Uint8Array([segment.index]),byteLength:1,mimeType:'video/webm',chunkCount:chunks.length};}});
  assert.equal(complete.status,'complete');assert.deepEqual(generated,[0,1,2]);assert.ok(storage.map.has('job:derivative:a:proxy-video'));assert.ok(storage.map.has('derivative:a:proxy-video:segment:0'));
  generated=[];
  const again=await runSegmentedDerivative({job:complete,track,chunks,sourceBytes:new Uint8Array(6),storage,generateSegment:async()=>{generated.push('unexpected');return{};}});
  assert.equal(again.status,'complete');assert.deepEqual(generated,[]);
});

test('segmented derivative runner persists retry state and eventually throws after max attempts', async () => {
  const storage=memoryStorage();const job=createDerivativeJob({assetId:'a',duration:1,segmentDuration:1,maxAttempts:2});let calls=0;
  await assert.rejects(()=>runSegmentedDerivative({job,storage,generateSegment:async()=>{calls++;throw new Error('boom');}}),/boom/);
  assert.equal(calls,2);const saved=storage.map.get('job:derivative:a:proxy-video').job;assert.equal(saved.status,'failed');assert.equal(saved.segments[0].attempts,2);
});
