import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRangeSource } from '../../../packages/core/src/range-source.js';
import { CutPlaybackEngine } from '../cut-playback-engine.js';

test('Cut frameAt reads only compact encoded source ranges', async () => {
  const raw=Uint8Array.from({length:4096},(_,i)=>i%251),source=new MemoryRangeSource(raw);
  const chunks=[
    {trackId:'video:1',type:'key',offset:100,byteLength:5,timestamp:0,duration:33333,sequence:0},
    {trackId:'video:1',type:'delta',offset:105,byteLength:5,timestamp:33333,duration:33333,sequence:1},
    {trackId:'video:1',type:'delta',offset:110,byteLength:5,timestamp:66666,duration:33333,sequence:2},
  ];
  let posted=0;
  const pool={schedule(_type,payload,options){posted=payload.bytes.byteLength;const frame={timestamp:33333,close(){}};queueMicrotask(()=>options.onProgress?.({detail:{frame}}));return{promise:Promise.resolve({frames:[]}),cancel(){}};},close(){}};
  const engine=new CutPlaybackEngine({sourceResolver:async()=>source,pool,demuxSource:async()=>({container:'mp4',tracks:[{id:'video:1',type:'video',frameRate:30}],chunks})});
  const result=await engine.frameAt({id:'asset',name:'clip',props:{hash:'h'}},.034);
  assert.equal(result.frame.timestamp,33333);
  assert.equal(posted,15);
  assert.equal(source.bytesRead,15);
  assert.ok(source.bytesRead<source.size/100);
  engine.close();
});
