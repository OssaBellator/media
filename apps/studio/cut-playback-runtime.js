import { createCutPlaybackEngine } from './cut-playback-factory.js';
import { CompositionPlaybackEngine } from './composition-playback-engine.js';
import { createCutFidelityPlayback } from './cut-fidelity-playback.js';
import { BrowserFrameProvider } from './render-engine.js';
import { BrowserGpuCompositionRenderer } from './gpu-composition-renderer.js';
import { CutPlaybackSession } from './cut-playback-session.js';

export function createCutPlaybackRuntime({
  blobResolver,
  sourceResolver,
  videoEngine=null,
  fallbackProvider=null,
  gpuRenderer=null,
  compositionEngine=null,
  fidelityEngine=null,
  workerCount,
  forceInline=false,
  sourceCacheBytes=128*1024*1024,
  fallbackCacheBytes=128*1024*1024,
  gpuCacheBytes=192*1024*1024,
  maxWidth=1600,
  maxHeight=900,
  maxPixels=1_500_000,
}={}){
  const ownedVideo=videoEngine??createCutPlaybackEngine({blobResolver,sourceResolver,workerCount,forceInline,sourceCacheBytes});
  const ownedFallback=fallbackProvider??new BrowserFrameProvider({blobResolver,maxCacheBytes:fallbackCacheBytes,concurrency:2});
  const ownedGpu=gpuRenderer??new BrowserGpuCompositionRenderer({maxCacheBytes:gpuCacheBytes});
  const ownedComposition=compositionEngine??new CompositionPlaybackEngine({videoEngine:ownedVideo,fallbackProvider:ownedFallback,gpuRenderer:ownedGpu,maxWidth,maxHeight,maxPixels});
  const ownedFidelity=fidelityEngine??createCutFidelityPlayback({compositionEngine:ownedComposition});
  const session=new CutPlaybackSession({fidelityEngine:ownedFidelity,compositionEngine:ownedComposition,videoEngine:ownedVideo});
  session.resources={videoEngine:ownedVideo,fallbackProvider:ownedFallback,gpuRenderer:ownedGpu,compositionEngine:ownedComposition,fidelityEngine:ownedFidelity};
  return session;
}

export function installCutPlaybackBridge(runtime,{target=globalThis.window}={}){
  if(!runtime||typeof runtime.present!=='function')throw new Error('Cut playback bridge requires runtime');
  if(!target?.addEventListener)return()=>{};
  const present=(event)=>{
    const detail=event?.detail??{},graph=detail.graph,time=Number(detail.time)||0,container=detail.container??globalThis.document?.querySelector?.('.cut-preview .composition-frame');
    if(!graph||!container)return;
    runtime.present(graph,time,{mode:detail.mode??'scrub',container,priority:detail.priority,signal:detail.signal}).catch((error)=>{
      if(error?.name!=='AbortError')target.dispatchEvent?.(new CustomEvent('media:cut-error',{detail:{error,time,mode:detail.mode??'scrub'}}));
    });
  };
  const invalidate=(event)=>runtime.invalidate({sources:Boolean(event?.detail?.sources)});
  const relink=(event)=>{const id=event?.detail?.assetId;if(id)runtime.invalidateAsset(id);else runtime.invalidate({sources:true});};
  target.addEventListener('media:cut-present',present);
  target.addEventListener('media:graph-invalidated',invalidate);
  target.addEventListener('media:asset-relinked',relink);
  const api={present:(graph,time,options={})=>runtime.present(graph,time,options),invalidate:(options)=>runtime.invalidate(options),invalidateAsset:(id)=>runtime.invalidateAsset(id),stats:()=>runtime.stats()};
  target.mediaCutPlayback=api;
  return()=>{
    target.removeEventListener('media:cut-present',present);target.removeEventListener('media:graph-invalidated',invalidate);target.removeEventListener('media:asset-relinked',relink);
    if(target.mediaCutPlayback===api)delete target.mediaCutPlayback;
  };
}
