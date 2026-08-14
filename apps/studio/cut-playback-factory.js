import { demuxIsoBmffSource } from '../../packages/core/src/isobmff-range.js';
import { demuxWebmSource } from '../../packages/core/src/webm-range.js';
import { sniffContainer } from '../../packages/core/src/media-kernel.js';
import { readRange } from '../../packages/core/src/range-source.js';
import { WorkerKernelClient, InlineKernelClient } from './kernel-client.js';
import { KernelWorkerPool } from './kernel-pool.js';
import { CutPlaybackEngine } from './cut-playback-engine.js';
import { createAssetRangeSource } from './media-source.js';
export function createCutPlaybackEngine({blobResolver,sourceResolver,workerCount=Math.min(4,Math.max(1,(globalThis.navigator?.hardwareConcurrency??4)-1)),forceInline=false,sourceCacheBytes=96*1024*1024,sourcePageSize=1024*1024,fragmentedFallbackMaxBytes=256*1024*1024}={}){
  const clientFactory=forceInline||typeof Worker!=='function'?()=>new InlineKernelClient():()=>new WorkerKernelClient();
  const pool=new KernelWorkerPool({size:workerCount,clientFactory});
  const resolve=sourceResolver??((asset)=>createAssetRangeSource(asset,{blobResolver,pageSize:sourcePageSize,maxCacheBytes:sourceCacheBytes}));
  return new CutPlaybackEngine({sourceResolver:resolve,pool,async demuxSource(source,asset){const head=await readRange(source,0,Math.min(32,source.size));const container=sniffContainer({mimeType:asset?.props?.mimeType,name:asset?.name,bytes:head});if(container==='mp4'||container==='mov')return demuxIsoBmffSource(source,{container,fragmentedFallbackMaxBytes});if(container==='webm')return demuxWebmSource(source);throw new Error(`Cut kernel playback does not support ${container}`);}});
}
