import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryByteSink } from '../../../packages/core/src/byte-sink.js';
import { renderProgressiveTimelineExport, renderTimelineExport } from '../deliver-runtime.js';

class FakeFrame { constructor(source,init){this.source=source;this.timestamp=init.timestamp;this.duration=init.duration;this.closed=false;}close(){this.closed=true;} }
class FakeVideoEncoder {
  static instances=[];
  constructor(config,options){this.config=config;this.options=options;this.frames=[];FakeVideoEncoder.instances.push(this);}
  async encode(frame){this.frames.push(frame.timestamp);}
  async flush(){}
  result(){return{type:'video',id:'video:deliver',codec:this.config.codec,config:this.config,width:this.config.width,height:this.config.height,chunks:this.frames.map((timestamp,i)=>({timestamp,dts:timestamp,duration:33_333,sequence:i,keyframe:i===0,type:i===0?'key':'delta',payload:new Uint8Array([i+1]).buffer,decoderConfig:{codec:this.config.codec,description:new Uint8Array([1]).buffer}}))};}
  close(){}
}
class FakeAudioEncoder {
  constructor(config){this.config=config;this.blocks=[];}
  async encode(data){this.blocks.push(data.timestamp);}
  async flush(){}
  result(){return{type:'audio',id:'audio:deliver',codec:this.config.codec,config:this.config,sampleRate:this.config.sampleRate,channels:this.config.numberOfChannels,chunks:this.blocks.map((timestamp,i)=>({timestamp,dts:timestamp,duration:21_333,sequence:i,type:'key',keyframe:true,payload:new Uint8Array([9]).buffer,decoderConfig:{codec:this.config.codec,description:new Uint8Array([2]).buffer}}))};}
  close(){}
}
class FakeAudioData {constructor(init){Object.assign(this,init);}close(){this.closed=true;}}
const manifest={signature:'sig',settings:{fps:2,rangeStart:0,rangeEnd:1,width:320,height:180}};

test('timeline export renders frames sequentially and builds an in-memory mux plan', async () => {
  const rendered=[];const progress=[];
  const result=await renderTimelineExport({manifest,container:'mp4',renderFrame:async(time,index)=>{rendered.push({time,index});return{index};},videoConfig:{codec:'avc1.640028'},frameFactory:(source,init)=>new FakeFrame(source,init),VideoEncoderClass:FakeVideoEncoder,muxMp4Fn:(plan)=>new Uint8Array([plan.samples.length]),onProgress:(x)=>progress.push(x.stage)});
  assert.deepEqual(rendered.map((x)=>x.index),[0,1]);assert.equal(result.bytes[0],2);assert.equal(result.plan.samples.length,2);assert.ok(progress.includes('video'));assert.equal(progress.at(-1),'mux');
});

test('timeline export streams fragmented MP4 segments to a byte sink', async () => {
  const sink=new MemoryByteSink();
  const result=await renderTimelineExport({manifest,container:'mp4',fragmented:true,sink,segmentDuration:.5,renderFrame:async()=>({}),videoConfig:{codec:'avc1.640028'},frameFactory:(source,init)=>new FakeFrame(source,init),VideoEncoderClass:FakeVideoEncoder});
  assert.equal(result.streamed,true);assert.equal(result.fragmented,true);assert.ok(sink.byteLength>0);
});

test('timeline export encodes offline audio blocks alongside video', async () => {
  const pcm={sampleRate:4,length:4,channels:[Float32Array.from([0,0,0,0]),Float32Array.from([0,0,0,0])]};
  const result=await renderTimelineExport({manifest,container:'webm',renderFrame:async()=>({}),renderAudioPcm:async()=>pcm,videoConfig:{codec:'vp09.00.10.08'},audioConfig:{codec:'opus',sampleRate:4,numberOfChannels:2,blockFrames:2},frameFactory:(source,init)=>new FakeFrame(source,init),audioDataFactory:(block,timestamp)=>new FakeAudioData({timestamp,block}),VideoEncoderClass:FakeVideoEncoder,AudioEncoderClass:FakeAudioEncoder,muxWebmFn:(plan)=>new Uint8Array([plan.tracks.length,plan.samples.length])});
  assert.equal(result.plan.tracks.length,2);assert.equal(result.bytes[0],2);assert.ok(result.plan.samples.some((s)=>s.trackId==='audio:deliver'));
});


class ProgressiveVideoEncoder {
  constructor(config,options={}){this.config=config;this.options=options;this.count=0;this.decoderConfig={codec:config.codec,description:new Uint8Array([1,2,3,4]).buffer};}
  async encode(frame){const index=this.count++,timestamp=Number(frame.timestamp??0),keyframe=index===0||index%2===0;this.options.onChunk?.({trackId:'video:deliver',timestamp,dts:timestamp,duration:Number(frame.duration??500000),sequence:index,keyframe,type:keyframe?'key':'delta',byteLength:1,payload:new Uint8Array([index+1]).buffer,decoderConfig:index===0?this.decoderConfig:null});}
  async flush(){}
  result(){return{id:'video:deliver',type:'video',codec:this.config.codec,config:this.config,decoderConfig:this.decoderConfig,width:this.config.width,height:this.config.height,chunks:[]};}
  close(){}
}

test('progressive fMP4 export does not retain the complete video stream before writing', async () => {
  const sink=new MemoryByteSink(),longManifest={signature:'stream',settings:{fps:2,rangeStart:0,rangeEnd:3,width:320,height:180}};
  const result=await renderProgressiveTimelineExport({manifest:longManifest,container:'mp4',sink,segmentDuration:1,renderFrame:async()=>({}),videoConfig:{codec:'avc1.640028'},frameFactory:(source,init)=>new FakeFrame(source,init),VideoEncoderClass:ProgressiveVideoEncoder});
  assert.equal(result.progressive,true);assert.equal(result.videoChunks,6);assert.ok(result.segments>=2);assert.ok(sink.byteLength>0);const text=Buffer.from(sink.bytes()).toString('latin1');assert.ok(text.includes('moov'));assert.ok(text.includes('moof'));
});

test('progressive WebM export streams clusters directly to the sink', async () => {
  const sink=new MemoryByteSink(),value={signature:'webm',settings:{fps:2,rangeStart:0,rangeEnd:2,width:320,height:180}};
  const result=await renderProgressiveTimelineExport({manifest:value,container:'webm',sink,segmentDuration:1,renderFrame:async()=>({}),videoConfig:{codec:'vp09.00.10.08'},frameFactory:(source,init)=>new FakeFrame(source,init),VideoEncoderClass:ProgressiveVideoEncoder});
  assert.equal(result.videoChunks,4);assert.ok(result.summary.clusters>=1);assert.equal(sink.bytes()[0],0x1a);
});
