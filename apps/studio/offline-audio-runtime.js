import { createAudioMixPlan } from '../../packages/core/src/audio.js';
import { analyzeLoudness, normalizeLoudness } from '../../packages/core/src/loudness.js';
import { sniffContainer } from '../../packages/core/src/media-kernel.js';
import { renderAutomatedMix } from '../../packages/core/src/offline-audio.js';
import { readRange } from '../../packages/core/src/range-source.js';
import { demuxIsoBmffAutoSource } from '../../packages/core/src/isobmff-auto-range.js';
import { demuxWebmSource } from '../../packages/core/src/webm-range.js';
import { createAssetRangeSource } from './media-source.js';
import { decodeCompressedAudioRanges } from './range-audio-decoder.js';
import { decodeChunkDescriptors } from './webcodecs.js';
import { OfflineAudioSession } from './offline-audio-session.js';

async function decodeBlobPcm(blob){const Ctor=globalThis.AudioContext??globalThis.webkitAudioContext;if(!Ctor)throw new Error('AudioContext is unavailable for compatibility audio decode');const context=new Ctor();try{const decoded=await context.decodeAudioData(await blob.arrayBuffer());return{sampleRate:decoded.sampleRate,length:decoded.length,channels:Array.from({length:decoded.numberOfChannels},(_,index)=>new Float32Array(decoded.getChannelData(index)))}}finally{await context.close().catch(()=>{});}}
async function demuxRangeSource(source,asset){const head=await readRange(source,0,Math.min(32,source.size)),container=sniffContainer({mimeType:asset?.props?.mimeType,name:asset?.name,bytes:head});if(container==='mp4'||container==='mov')return demuxIsoBmffAutoSource(source,{container});if(container==='webm')return demuxWebmSource(source);throw new Error(`Range source container ${container} is unsupported`);}
export function sourceRangesForAudioPlan(plan,assetId){return(plan.sources??[]).filter((item)=>item.assetId===assetId).map((item)=>{const start=Number(item.sourceInSample??0)/Number(plan.sampleRate),timelineFrames=Math.max(0,Number(item.endSample)-Number(item.startSample)),duration=timelineFrames/Number(plan.sampleRate)*Math.max(0,Number(item.playbackRate??1));return{start,end:start+duration};});}

export function createOfflineAudioRuntime({blobResolver,sourceCacheBytes=96*1024*1024,rangeMergeGap=.08,decodeChunks=decodeChunkDescriptors,decodeBlob=decodeBlobPcm}={}){
  if(typeof blobResolver!=='function')throw new Error('Offline audio runtime requires blobResolver');
  const decodeAsset=async(graph,plan,assetId,{signal}={})=>{
    const asset=graph.nodes?.[assetId];if(!asset)throw new Error(`Audio source ${assetId} is unavailable`);
    let source=null,rangeError=null;
    try{
      source=await createAssetRangeSource(asset,{blobResolver,maxCacheBytes:sourceCacheBytes});
      const demux=await demuxRangeSource(source,asset),track=demux.tracks.find((item)=>item.type==='audio');
      if(!track)throw new Error(`No compressed audio track found for ${asset.name??assetId}`);
      const chunks=demux.chunks.filter((chunk)=>chunk.trackId===track.id),ranges=sourceRangesForAudioPlan(plan,assetId),sparse=await decodeCompressedAudioRanges({ranges,source,track,chunks,signal,decodeChunkDescriptors:decodeChunks,rangeMergeGap});
      if(sparse?.sampleRate>0)return sparse;
      throw new Error('Range audio decoder produced no PCM');
    }catch(error){rangeError=error;}
    finally{source?.clear?.();}
    if(signal?.aborted)throw signal.reason??rangeError;
    const blob=await blobResolver(assetId,asset);
    if(!blob)throw rangeError??new Error(`Audio source ${assetId} is offline`);
    try{return await decodeBlob(blob);}catch{throw rangeError??new Error(`Audio source ${assetId} could not be decoded`);}
  };
  return new OfflineAudioSession({createPlan:createAudioMixPlan,decodeAsset,renderMix:renderAutomatedMix,analyze:analyzeLoudness,normalize:normalizeLoudness});
}
