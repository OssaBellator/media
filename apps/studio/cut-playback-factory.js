import { demuxIsoBmff } from '../../packages/core/src/isobmff-demux.js';
import { demuxWebm } from '../../packages/core/src/webm-demux.js';
import { sniffContainer } from '../../packages/core/src/media-kernel.js';
import { WorkerKernelClient, InlineKernelClient } from './kernel-client.js';
import { KernelWorkerPool } from './kernel-pool.js';
import { CutPlaybackEngine } from './cut-playback-engine.js';
export function createCutPlaybackEngine({blobResolver,workerCount=Math.min(4,Math.max(1,(globalThis.navigator?.hardwareConcurrency??4)-1)),forceInline=false}={}){
  const clientFactory=forceInline||typeof Worker!=='function'?()=>new InlineKernelClient():()=>new WorkerKernelClient();
  const pool=new KernelWorkerPool({size:workerCount,clientFactory});
  return new CutPlaybackEngine({blobResolver,pool,demuxSource(bytes,asset){const container=sniffContainer({mimeType:asset?.props?.mimeType,name:asset?.name,bytes:bytes.subarray(0,32)});if(container==='webm')return demuxWebm(bytes);if(container==='mp4'||container==='mov')return demuxIsoBmff(bytes,{container});throw new Error(`Cut kernel playback does not support ${container}`);}});
}
