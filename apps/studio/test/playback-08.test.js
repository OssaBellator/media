import assert from 'node:assert/strict';
import test from 'node:test';
import { CutPlaybackEngine, StreamingFrameCache } from '../cut-playback-engine.js';

function frame(timestamp){return{timestamp,codedWidth:320,codedHeight:180,closed:false,close(){this.closed=true;}};}

test('streaming frame cache is bounded and closes evicted frames', () => {
  const cache=new StreamingFrameCache({maxFrames:2});const a=frame(0),b=frame(10),c=frame(20);cache.add(a);cache.add(b);cache.add(c);assert.equal(a.closed,true);assert.equal(cache.range().count,2);assert.equal(cache.nearest(19),c);cache.clear();assert.equal(b.closed,true);assert.equal(c.closed,true);
});

test('Cut playback compacts source bytes and accepts streamed worker frames before task completion', async () => {
  const scheduled=[];
  const pool={schedule(kind,payload,options){scheduled.push({kind,payload,options});let resolve;const promise=new Promise((r)=>resolve=r);queueMicrotask(()=>{options.onProgress({detail:{frame:frame(1_000_000)}});setTimeout(()=>resolve({submitted:2,frames:[]}),10);});return{id:'h',promise,cancel(){return true;}};},close(){}};
  const bytes=new Uint8Array([9,9,1,2,3,9,4,5,9]);
  const engine=new CutPlaybackEngine({blobResolver:async()=>new Blob([bytes]),pool,demuxSource:async()=>({container:'mp4',tracks:[{id:'v',type:'video',width:320,height:180,frameRate:30}],chunks:[{trackId:'v',type:'key',timestamp:1_000_000,duration:33_333,offset:2,byteLength:3,sequence:0},{trackId:'v',type:'delta',timestamp:1_033_333,duration:33_333,offset:6,byteLength:2,sequence:1}]})});
  const result=await engine.frameAt({id:'asset',name:'A'},1);
  assert.equal(result.frame.timestamp,1_000_000);
  assert.equal(scheduled[0].kind,'decode-video');
  assert.equal(scheduled[0].payload.stream,true);
  assert.deepEqual([...new Uint8Array(scheduled[0].payload.bytes)],[1,2,3,4,5]);
  assert.deepEqual(scheduled[0].payload.chunks.map((c)=>c.offset),[0,3]);
  engine.close();
});

test('Cut playback returns cached frames without a second decode task', async () => {
  let calls=0;
  const pool={schedule(_kind,_payload,options){calls++;const f=frame(0);queueMicrotask(()=>options.onProgress({detail:{frame:f}}));return{promise:Promise.resolve({frames:[]}),cancel(){}};},close(){}};
  const engine=new CutPlaybackEngine({blobResolver:async()=>new Blob([new Uint8Array([1])]),pool,demuxSource:async()=>({container:'mp4',tracks:[{id:'v',type:'video',width:1,height:1,frameRate:30}],chunks:[{trackId:'v',type:'key',timestamp:0,duration:1_000_000,offset:0,byteLength:1,sequence:0}]})});
  engine.prefetch=async()=>null;
  await engine.frameAt({id:'a'},0);
  await engine.frameAt({id:'a'},0);
  assert.equal(calls,1);
  engine.close();
});

test('Cut playback invalidates cached demux state when a source fingerprint changes', async () => {
  let resolves=0;
  const pool={schedule(_k,_p,o){queueMicrotask(()=>o.onProgress({detail:{frame:frame(0)}}));return{promise:Promise.resolve({frames:[]}),cancel(){}};},close(){}};
  const engine=new CutPlaybackEngine({blobResolver:async()=>{resolves++;return new Blob([new Uint8Array([1])]);},pool,demuxSource:async()=>({tracks:[{id:'v',type:'video',width:1,height:1}],chunks:[{trackId:'v',type:'key',timestamp:0,duration:1_000_000,offset:0,byteLength:1}]})});engine.prefetch=async()=>null;
  await engine.frameAt({id:'a',props:{hash:'one'}},0);await engine.frameAt({id:'a',props:{hash:'one'}},0);await engine.frameAt({id:'a',props:{hash:'two'}},0);assert.equal(resolves,2);engine.close();
});
