export class KernelCompositionFrameProvider {
  constructor({videoEngine,fallbackProvider,fallbackVideo=true}={}){if(!videoEngine||typeof videoEngine.frameAt!=='function')throw new Error('KernelCompositionFrameProvider requires videoEngine');if(!fallbackProvider||typeof fallbackProvider.get!=='function')throw new Error('KernelCompositionFrameProvider requires fallbackProvider');this.videoEngine=videoEngine;this.fallbackProvider=fallbackProvider;this.fallbackVideo=fallbackVideo!==false;this.videoFallbacks=0;}
  async get(asset,time=0,options={}){if(asset?.props?.mediaKind==='video'){try{const result=await this.videoEngine.frameAt(asset,time,{priority:options.priority??100,direction:options.direction??1,signal:options.signal});return result.frame;}catch(error){if(!this.fallbackVideo)throw error;this.videoFallbacks++;return this.fallbackProvider.get(asset,time,options);}}return this.fallbackProvider.get(asset,time,options);}
  clear(){this.videoEngine.clear?.();this.fallbackProvider.clear?.();}
  stats(){return{video:this.videoEngine.sources?.size??null,videoFallbacks:this.videoFallbacks,fallback:this.fallbackProvider.stats?.()??null};}
}
