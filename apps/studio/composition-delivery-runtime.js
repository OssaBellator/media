import { createAudioMixPlan } from '../../packages/core/src/audio.js';
import { createRenderManifest } from '../../packages/core/src/deliver.js';
import { createCutPlaybackEngine } from './cut-playback-factory.js';
import { CompositionFrameRenderer } from './composition-frame-renderer.js';
import { renderCompositionTimelineExport } from './composition-export.js';
import { KernelCompositionFrameProvider } from './kernel-frame-provider.js';
import { BrowserFrameProvider } from './render-engine.js';
import { CompositionDeliverySession } from './composition-delivery-session.js';
import { createOfflineAudioRuntime } from './offline-audio-runtime.js';

export function createCompositionDeliveryRuntime({blobResolver,sourceResolver,sourceCacheBytes=160*1024*1024,fallbackCacheBytes=128*1024*1024,offlineAudio=null}={}){
  if(typeof blobResolver!=='function'&&typeof sourceResolver!=='function')throw new Error('Composition delivery runtime requires a source resolver');
  const audioRuntime=offlineAudio??createOfflineAudioRuntime({blobResolver});
  return new CompositionDeliverySession({
    createManifest:createRenderManifest,
    audioPlanForOutput:(graph,output)=>createAudioMixPlan(graph,{start:Number(output.props.rangeStart??0),end:Number(output.props.rangeEnd),sampleRate:48000,blockSize:1024}),
    renderOfflineAudio:(graph,output,options)=>audioRuntime.render(graph,output,options),
    createFrameRenderer:()=>{
      const videoEngine=createCutPlaybackEngine({blobResolver,sourceResolver,sourceCacheBytes}),fallbackProvider=new BrowserFrameProvider({blobResolver,maxCacheBytes:fallbackCacheBytes,concurrency:2}),frameProvider=new KernelCompositionFrameProvider({videoEngine,fallbackProvider,fallbackVideo:false}),renderer=new CompositionFrameRenderer({frameProvider});
      renderer.close=()=>{videoEngine.close();fallbackProvider.clear?.();};return renderer;
    },
    renderExport:renderCompositionTimelineExport,
  });
}
