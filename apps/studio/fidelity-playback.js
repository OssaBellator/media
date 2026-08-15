import {FidelityController,resolveCompositionFps} from '../../packages/core/src/fidelity-scheduler.js';
function clock(){return globalThis.performance?.now?.()??Date.now();}

export class FidelityPlaybackEngine{
  constructor({evaluate,render,controller=new FidelityController(),defaultFps=30}={}){
    if(typeof evaluate!=='function'||typeof render!=='function')throw new Error('FidelityPlaybackEngine requires evaluate and render functions');
    this.evaluate=evaluate;
    this.render=render;
    this.controller=controller;
    this.defaultFps=defaultFps;
    this.metrics={requests:0,presented:0,stale:0,failed:0,cancelled:0};
  }
  async present(graph,time,{compositionId,mode='playback',fps=null,requestedTemporalSamples,requestedVectorSupersample,...options}={}){
    this.metrics.requests++;
    const evaluated=this.evaluate(graph,{compositionId,time});
    const resolvedFps=resolveCompositionFps(graph,evaluated,{fps,defaultFps:this.defaultFps});
    const fidelity=this.controller.plan({mode,fps:resolvedFps,requestedTemporalSamples,requestedVectorSupersample});
    const started=clock();
    try{
      const result=await this.render(evaluated,{...options,fidelity,graph,time,mode});
      const stale=Boolean(result?.stale);
      this.controller.record({durationMs:clock()-started,stale});
      if(stale)this.metrics.stale++;else this.metrics.presented++;
      return{...result,evaluated,fidelity};
    }catch(error){
      if(error?.name==='AbortError')this.metrics.cancelled++;else this.metrics.failed++;
      throw error;
    }
  }
  reset({metrics=false}={}){
    this.controller.reset?.();
    if(metrics)this.metrics={requests:0,presented:0,stale:0,failed:0,cancelled:0};
    return this.stats();
  }
  stats(){return{...this.metrics,fidelity:this.controller.snapshot()};}
}
