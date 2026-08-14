import { createDefaultKernelRuntime } from './kernel-handlers.js';
import { createBrowserCodecRouter } from './codec-router.js';

function bytesFromPayload(payload) {
  const input = payload?.bytes;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new Error('Kernel codec payload requires binary bytes');
}

export function createProductionKernelRuntime({codecRouter=createBrowserCodecRouter()}={}) {
  const runtime=createDefaultKernelRuntime();
  const fallbackDecodeAudio=runtime.handlers.get('decode-audio');
  const fallbackEncodeAudio=runtime.handlers.get('encode-audio');
  runtime.register('decode-video',async(payload,{signal,progress})=>{
    const bytes=bytesFromPayload(payload);if(payload?.track?.type!=='video'||!Array.isArray(payload?.chunks))throw new Error('decode-video requires a video track and chunk descriptors');
    const frames=[],stream=Boolean(payload.stream),total=Math.max(1,payload.chunks.length);let produced=0;
    const routed=await codecRouter.run('decode-video',{track:payload.track,chunks:payload.chunks,source:bytes,options:{maxQueue:payload.maxQueue??8,probeSupport:true,onOutput:(frame)=>{produced++;if(stream)progress(Math.min(.99,produced/total),{stage:'frame',frame,index:produced-1});else{frames.push(frame);progress(Math.min(.99,frames.length/total),'decode');}}}},{signal,context:{taskKind:'decode-video'}});
    progress(1,{stage:'flush',produced,backendId:routed.backendId});return{trackId:payload.track.id,submitted:Number(routed.result?.submitted??payload.chunks.length),produced,frames:stream?[]:frames,streamed:stream,backendId:routed.backendId};
  });
  runtime.register('decode-audio',async(payload,{signal,progress})=>{
    if(!(payload?.track&&Array.isArray(payload?.chunks)))return fallbackDecodeAudio(payload,{signal,progress});
    const bytes=bytesFromPayload(payload);if(payload.track.type!=='audio')throw new Error('decode-audio track must be audio');const frames=[],stream=Boolean(payload.stream),total=Math.max(1,payload.chunks.length);let produced=0;
    const routed=await codecRouter.run('decode-audio',{track:payload.track,chunks:payload.chunks,source:bytes,options:{maxQueue:payload.maxQueue??16,probeSupport:true,onOutput:(frame)=>{produced++;if(stream)progress(Math.min(.99,produced/total),{stage:'audio-frame',frame,index:produced-1});else{frames.push(frame);progress(Math.min(.99,frames.length/total),'decode');}}}},{signal,context:{taskKind:'decode-audio'}});
    progress(1,{stage:'flush',produced,backendId:routed.backendId});return{trackId:payload.track.id,submitted:Number(routed.result?.submitted??payload.chunks.length),produced,frames:stream?[]:frames,streamed:stream,backendId:routed.backendId};
  });
  runtime.register('encode-video',async(payload,{signal,progress})=>{if(!Array.isArray(payload?.frames)||!payload.config)throw new Error('encode-video requires frames and config');const total=Math.max(1,payload.frames.length),records=[];let encoded=0;const routed=await codecRouter.run('encode-video',{frames:payload.frames,config:payload.config,options:{trackId:payload.trackId??'video:encoded',maxQueue:payload.maxQueue??8,keyFrameInterval:payload.keyFrameInterval??60,onChunk:(record)=>{records.push(record);encoded++;progress(Math.min(.99,encoded/total),'encode');}}},{signal,context:{taskKind:'encode-video'}});progress(1,{stage:'flush',backendId:routed.backendId});return{...routed.result,chunks:routed.result?.chunks??records,backendId:routed.backendId};});
  runtime.register('encode-audio',async(payload,{signal,progress})=>{if(!(Array.isArray(payload?.frames)&&payload.config))return fallbackEncodeAudio(payload,{signal,progress});const total=Math.max(1,payload.frames.length),records=[];let encoded=0;const routed=await codecRouter.run('encode-audio',{frames:payload.frames,config:payload.config,options:{trackId:payload.trackId??'audio:encoded',maxQueue:payload.maxQueue??16,onChunk:(record)=>{records.push(record);encoded++;progress(Math.min(.99,encoded/total),'encode');}}},{signal,context:{taskKind:'encode-audio'}});progress(1,{stage:'flush',backendId:routed.backendId});return{...routed.result,chunks:routed.result?.chunks??records,backendId:routed.backendId};});
  return runtime;
}
