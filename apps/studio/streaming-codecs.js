function abortError(){const error=new Error('Encoding aborted');error.name='AbortError';return error;}
function record(chunk,metadata,sequence,trackId){const bytes=new Uint8Array(Number(chunk.byteLength)||0);chunk.copyTo(bytes);const buffer=bytes.buffer;return{trackId,type:chunk.type==='key'?'key':'delta',keyframe:chunk.type==='key',timestamp:Number(chunk.timestamp)||0,dts:Number(chunk.timestamp)||0,duration:Number(chunk.duration)||0,sequence,byteLength:bytes.byteLength,payload:buffer,bytes:buffer,decoderConfig:metadata?.decoderConfig??null};}
class BaseStreamingEncoder {
  constructor({Ctor,config,trackId,maxQueue=8,signal,onChunk=()=>{},retainChunks=true}){if(typeof Ctor!=='function')throw new Error('WebCodecs encoder is unavailable');this.Ctor=Ctor;this.config=config;this.trackId=trackId;this.maxQueue=Math.max(1,Number(maxQueue)||8);this.signal=signal;this.onChunk=onChunk;this.retainChunks=retainChunks!==false;this.chunks=[];this.decoderConfig=null;this.emitted=0;this.failure=null;this.submitted=0;this.closed=false;this.encoder=new Ctor({output:(chunk,metadata)=>{const value=record(chunk,metadata,this.emitted++,this.trackId);if(value.decoderConfig)this.decoderConfig=value.decoderConfig;if(this.retainChunks)this.chunks.push(value);this.onChunk(value);},error:(error)=>{this.failure=error;}});this.encoder.configure(config);}
  async pressure(){if(Number(this.encoder.encodeQueueSize??0)>=this.maxQueue)await this.encoder.flush?.();if(this.failure)throw this.failure;if(this.signal?.aborted)throw abortError();}
  async flush(){if(this.closed)return;await this.encoder.flush?.();if(this.failure)throw this.failure;}
  result(type){return{id:this.trackId,type,codec:this.config.codec,config:this.config,decoderConfig:this.decoderConfig,chunks:this.chunks};}
  close(){if(this.closed)return;this.closed=true;try{this.encoder.close?.();}catch{}}
}
export class StreamingVideoEncoder extends BaseStreamingEncoder {
  constructor(config,options={}){super({Ctor:options.VideoEncoderCtor??globalThis.VideoEncoder,config,trackId:options.trackId??'video:0',maxQueue:options.maxQueue??8,signal:options.signal,onChunk:options.onChunk,retainChunks:options.retainChunks});this.keyFrameInterval=Math.max(1,Math.round(Number(options.keyFrameInterval)||60));}
  async encode(frame){await this.pressure();this.encoder.encode(frame,{keyFrame:this.submitted%this.keyFrameInterval===0});this.submitted++;}
  result(){return{...super.result('video'),width:Number(this.config.width??this.config.codedWidth),height:Number(this.config.height??this.config.codedHeight)};}
}
export class StreamingAudioEncoder extends BaseStreamingEncoder {
  constructor(config,options={}){super({Ctor:options.AudioEncoderCtor??globalThis.AudioEncoder,config,trackId:options.trackId??'audio:0',maxQueue:options.maxQueue??16,signal:options.signal,onChunk:options.onChunk,retainChunks:options.retainChunks});}
  async encode(frame){await this.pressure();this.encoder.encode(frame);this.submitted++;}
  result(){return{...super.result('audio'),sampleRate:Number(this.config.sampleRate),channels:Number(this.config.numberOfChannels)};}
}
