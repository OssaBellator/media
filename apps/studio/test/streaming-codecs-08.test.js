import assert from 'node:assert/strict';
import test from 'node:test';
import { StreamingAudioEncoder, StreamingVideoEncoder } from '../streaming-codecs.js';

class FakeChunk {
  constructor({type='delta',timestamp=0,duration=1,data=[1,2]}){this.type=type;this.timestamp=timestamp;this.duration=duration;this.data=Uint8Array.from(data);this.byteLength=this.data.byteLength;}
  copyTo(target){target.set(this.data);}
}
class FakeEncoder {
  static configured=[];
  constructor({output,error}){this.output=output;this.error=error;this.encodeQueueSize=0;this.frames=[];this.flushes=0;this.closed=false;}
  configure(config){this.config=config;FakeEncoder.configured.push(config);}
  encode(frame,options={}){this.frames.push({frame,options});const index=this.frames.length-1;this.output(new FakeChunk({type:options.keyFrame?'key':'delta',timestamp:frame.timestamp??index,duration:frame.duration??1,data:[index+1]}),index===0?{decoderConfig:{codec:this.config.codec,description:new Uint8Array([7]).buffer}}:undefined);}
  async flush(){this.flushes++;this.encodeQueueSize=0;}
  close(){this.closed=true;}
}

test('streaming video encoder marks deterministic keyframes and preserves decoder config', async () => {
  const encoder=new StreamingVideoEncoder({codec:'vp09.00.10.08',width:320,height:180},{trackId:'v',VideoEncoderCtor:FakeEncoder,keyFrameInterval:2});
  await encoder.encode({timestamp:0,duration:33});await encoder.encode({timestamp:33,duration:33});await encoder.encode({timestamp:66,duration:33});await encoder.flush();
  const result=encoder.result();
  assert.deepEqual(result.chunks.map((c)=>c.type),['key','delta','key']);
  assert.equal(result.chunks[0].decoderConfig.codec,'vp09.00.10.08');
  assert.deepEqual([...new Uint8Array(result.chunks[2].payload)],[3]);
  encoder.close();
});

test('streaming audio encoder emits copied mux-ready records', async () => {
  const encoder=new StreamingAudioEncoder({codec:'opus',sampleRate:48000,numberOfChannels:2},{trackId:'a',AudioEncoderCtor:FakeEncoder});
  await encoder.encode({timestamp:100,duration:20});await encoder.flush();const result=encoder.result();
  assert.equal(result.type,'audio');assert.equal(result.sampleRate,48000);assert.equal(result.channels,2);assert.equal(result.chunks[0].trackId,'a');encoder.close();
});

test('streaming encoders apply queue backpressure before accepting more frames', async () => {
  class PressureEncoder extends FakeEncoder { constructor(x){super(x);this.encodeQueueSize=10;} }
  const encoder=new StreamingVideoEncoder({codec:'vp8',width:16,height:16},{VideoEncoderCtor:PressureEncoder,maxQueue:4});
  await encoder.encode({timestamp:0});assert.equal(encoder.encoder.flushes,1);encoder.close();
});

test('streaming encoders abort before submitting work', async () => {
  const controller=new AbortController();controller.abort();const encoder=new StreamingVideoEncoder({codec:'vp8',width:16,height:16},{VideoEncoderCtor:FakeEncoder,signal:controller.signal});
  await assert.rejects(()=>encoder.encode({timestamp:0}),{name:'AbortError'});encoder.close();
});

test('streaming video encoder can release encoded payloads after onChunk delivery', async () => {
  const delivered=[];const encoder=new StreamingVideoEncoder({codec:'vp8',width:16,height:16},{VideoEncoderCtor:FakeEncoder,retainChunks:false,onChunk:(chunk)=>delivered.push(chunk)});await encoder.encode({timestamp:0});await encoder.flush();assert.equal(delivered.length,1);assert.equal(encoder.result().chunks.length,0);assert.equal(encoder.result().decoderConfig.codec,'vp8');encoder.close();
});
