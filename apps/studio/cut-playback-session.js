function abortError(message='Cut playback request aborted'){
  if(typeof DOMException==='function')return new DOMException(message,'AbortError');
  const error=new Error(message);error.name='AbortError';return error;
}
function frameKey(project,revision,time,mode){return `${String(project??'graph')}:${String(revision)}:${mode}:${Math.round((Number(time)||0)*1000)}`;}

export class CutPlaybackSession {
  constructor({fidelityEngine,compositionEngine,videoEngine=null}={}){
    if(!fidelityEngine||typeof fidelityEngine.present!=='function')throw new Error('CutPlaybackSession requires fidelityEngine');
    if(!compositionEngine||typeof compositionEngine.invalidate!=='function')throw new Error('CutPlaybackSession requires compositionEngine');
    this.fidelityEngine=fidelityEngine;this.compositionEngine=compositionEngine;this.videoEngine=videoEngine;
    this.presentAbort=null;this.lastFrameKey='';this.closed=false;this.generation=0;this.graphTokens=new WeakMap();this.graphSequence=0;
    this.metrics={requests:0,deduped:0,cancelled:0,failures:0,invalidations:0,sourceInvalidations:0};
  }
  async present(graph,time,{mode='scrub',container,priority=mode==='scrub'?120:100,signal}={}){
    if(this.closed)throw new Error('CutPlaybackSession is closed');
    if(!container)throw new Error('CutPlaybackSession requires a container');
    let revision='primitive';if(graph&&typeof graph==='object'){revision=this.graphTokens.get(graph);if(!revision){revision=++this.graphSequence;this.graphTokens.set(graph,revision);}}
    const key=frameKey(graph?.projectId,revision,time,mode);
    if(key===this.lastFrameKey){this.metrics.deduped++;return{deduped:true,key};}
    this.lastFrameKey=key;this.metrics.requests++;
    if(mode==='scrub'){
      this.presentAbort?.abort(abortError('Superseded by a newer scrub'));
      this.presentAbort=new AbortController();
    }
    const localSignal=mode==='scrub'?this.presentAbort.signal:signal;
    if(signal&&mode==='scrub'){
      if(signal.aborted)this.presentAbort.abort(signal.reason??abortError());
      else signal.addEventListener('abort',()=>this.presentAbort?.abort(signal.reason??abortError()),{once:true});
    }
    const generation=++this.generation;
    try{
      const result=await this.fidelityEngine.present(graph,Number(time)||0,{mode,container,priority,signal:localSignal});
      if(generation!==this.generation)return{...result,stale:true};
      return result;
    }catch(error){
      if(error?.name==='AbortError'){this.metrics.cancelled++;throw error;}
      this.lastFrameKey='';this.metrics.failures++;this.compositionEngine.showFallback?.(container);throw error;
    }
  }
  cancelInteractive(){if(this.presentAbort){this.presentAbort.abort(abortError());this.presentAbort=null;}this.lastFrameKey='';this.generation++;}
  invalidate({sources=false}={}){
    if(this.closed)return;
    this.cancelInteractive();this.metrics.invalidations++;
    this.fidelityEngine.reset?.();
    this.compositionEngine.invalidate();
    if(sources){this.metrics.sourceInvalidations++;this.videoEngine?.clear?.();this.compositionEngine.frameProvider?.clear?.();}
  }
  invalidateAsset(assetId){
    if(this.closed)return;
    this.cancelInteractive();this.metrics.invalidations++;this.metrics.sourceInvalidations++;
    this.fidelityEngine.reset?.();this.compositionEngine.invalidate();this.videoEngine?.clearAsset?.(assetId);this.compositionEngine.frameProvider?.clearAsset?.(assetId);
  }
  stats(){return{...this.metrics,composition:this.compositionEngine.stats?.()??null,video:this.videoEngine?.stats?.()??null,closed:this.closed};}
  close(){if(this.closed)return;this.cancelInteractive();this.closed=true;this.compositionEngine.close?.();this.videoEngine?.close?.();}
}

export function cutPlaybackFrameKey({projectId='graph',revision='revision',time=0,mode='scrub'}={}){return frameKey(projectId,revision,time,mode);}
