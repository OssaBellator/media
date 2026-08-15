import { evaluateComposition } from '../../packages/core/src/evaluation.js';
import { shouldTemporalAccumulate } from '../../packages/core/src/fidelity-render.js';
import { scaleRenderPlan } from '../../packages/core/src/render-scale.js';
import { renderPlanToCanvas2D } from './render-engine.js';
import { KernelCompositionFrameProvider } from './kernel-frame-provider.js';
import { renderTemporalCompositionToCanvas2D } from './temporal-composition-renderer.js';

function createCanvas(){if(globalThis.document?.createElement)return document.createElement('canvas');if(typeof OffscreenCanvas==='function')return new OffscreenCanvas(1,1);throw new Error('Composition playback requires a canvas implementation');}
function surfaceCanvas(container,backend,canvasFactory=createCanvas){let canvas=container?.querySelector?.(`canvas[data-composition-playback="${backend}"]`);if(!canvas&&container?.appendChild){canvas=canvasFactory();canvas.dataset.compositionPlayback=backend;canvas.className=`composition-playback-surface ${backend}`;if(globalThis.getComputedStyle&&getComputedStyle(container).position==='static')container.style.position='relative';Object.assign(canvas.style??{},{position:'absolute',inset:'0',width:'100%',height:'100%',zIndex:'3',pointerEvents:'none'});container.appendChild(canvas);}return canvas;}
function showSurface(container,backend=null){const video=container?.querySelector?.('video');if(video)video.style.visibility=backend?'hidden':'visible';for(const canvas of container?.querySelectorAll?.('canvas[data-composition-playback]')??[]){canvas.style.visibility=canvas.dataset.compositionPlayback===backend?'visible':'hidden';}}
function fidelityResolutionScale(fidelity){const value=Number(fidelity?.resolutionScale??1);return Number.isFinite(value)?Math.max(.25,Math.min(1,value)):1;}

export class CompositionPlaybackEngine {
  constructor({videoEngine,fallbackProvider,frameProvider,evaluate=evaluateComposition,scalePlan=scaleRenderPlan,renderer=renderPlanToCanvas2D,temporalRenderer=renderTemporalCompositionToCanvas2D,gpuRenderer=null,canvasFactory=createCanvas,maxWidth=1600,maxHeight=900,maxPixels=1_500_000}={}){
    if(!frameProvider&&!videoEngine)throw new Error('CompositionPlaybackEngine requires a frame provider or video engine');
    this.frameProvider=frameProvider??new KernelCompositionFrameProvider({videoEngine,fallbackProvider});
    this.evaluate=evaluate;
    this.scalePlan=scalePlan;
    this.renderer=renderer;
    this.temporalRenderer=temporalRenderer;
    this.gpuRenderer=gpuRenderer;
    this.canvasFactory=canvasFactory;
    this.maxWidth=maxWidth;
    this.maxHeight=maxHeight;
    this.maxPixels=maxPixels;
    this.generation=0;
    this.lastFidelity=null;
    this.metrics={requests:0,presented:0,stale:0,gpu:0,canvas2d:0,temporal:0,temporalSamples:0,fallback:0};
  }
  invalidate(){this.generation+=1;}
  async present(graph,time,container,{compositionId,...options}={}){
    const evaluated=this.evaluate(graph,{compositionId,time});
    return this.presentEvaluated(graph,evaluated,container,options);
  }
  async presentEvaluated(graph,evaluated,container,{priority=100,signal,fidelity=null,mode='playback'}={}){
    this.metrics.requests++;
    const generation=++this.generation;
    this.lastFidelity=fidelity?{...fidelity}:null;
    const raw=this.lastFidelity?{...evaluated,fidelity:this.lastFidelity}:evaluated;
    if(!raw.visual?.length){showSurface(container,null);this.metrics.fallback++;return{backend:'fallback',empty:true,plan:raw,fidelity:this.lastFidelity};}
    const resolutionScale=fidelityResolutionScale(this.lastFidelity);
    const scaleOptions={maxWidth:this.maxWidth*resolutionScale,maxHeight:this.maxHeight*resolutionScale,maxPixels:this.maxPixels*resolutionScale*resolutionScale};
    const plan=this.scalePlan(raw,scaleOptions);
    const assetResolver=(id)=>graph.nodes[id];
    const frameProvider=this.frameProvider?.forRequest?.({mode})??this.frameProvider;
    if(shouldTemporalAccumulate(raw,this.lastFidelity)){
      if(this.gpuRenderer?.supports?.(plan)&&typeof this.gpuRenderer.presentTemporal==='function'){
        try{
          const target=surfaceCanvas(container,'webgpu',this.canvasFactory);
          if(!target)throw new Error('GPU temporal composition target is unavailable');
          target.width=plan.width;target.height=plan.height;
          const gpu=await this.gpuRenderer.presentTemporal(target,graph,raw,{evaluate:this.evaluate,scalePlan:this.scalePlan,scaleOptions,assetResolver,frameProvider,priority,signal,fidelity:this.lastFidelity,shouldCommit:()=>generation===this.generation});
          if(gpu?.stale){this.metrics.stale++;return{stale:true,plan,result:gpu,fidelity:this.lastFidelity};}
          showSurface(container,'webgpu');this.metrics.presented++;this.metrics.gpu++;this.metrics.temporal++;this.metrics.temporalSamples+=gpu.samples?.length??0;
          return{...gpu,plan:gpu.plan??plan,canvas:target,fidelity:this.lastFidelity};
        }catch(error){if(error?.name==='AbortError')throw error;/* preserve deterministic Canvas2D temporal fallback */}
      }
      const scratch=this.canvasFactory();
      const temporal=await this.temporalRenderer(scratch,graph,raw,{evaluate:this.evaluate,scalePlan:this.scalePlan,scaleOptions,renderer:this.renderer,assetResolver,frameProvider,priority,signal,fidelity:this.lastFidelity,canvasFactory:this.canvasFactory});
      if(generation!==this.generation){this.metrics.stale++;return{stale:true,plan,result:temporal,fidelity:this.lastFidelity};}
      const target=surfaceCanvas(container,'canvas2d',this.canvasFactory);
      if(!target)throw new Error('Composition playback target is unavailable');
      target.width=plan.width;target.height=plan.height;
      const context=target.getContext?.('2d');
      if(!context)throw new Error('Composition playback target requires Canvas2D');
      context.clearRect(0,0,target.width,target.height);context.drawImage(scratch,0,0,target.width,target.height);
      const intrinsic=plan.visual.some((item)=>item.kind==='text'||item.kind==='shape'),sourceItems=plan.visual.filter((item)=>item.assetId),expectedSourceRenders=sourceItems.length*temporal.samples.length,allSourcesFailed=sourceItems.length>0&&temporal.errors?.length>=expectedSourceRenders;
      if(allSourcesFailed&&!intrinsic){showSurface(container,null);this.metrics.fallback++;return{backend:'fallback',plan,result:temporal,fidelity:this.lastFidelity};}
      showSurface(container,'canvas2d');this.metrics.presented++;this.metrics.canvas2d++;this.metrics.temporal++;this.metrics.temporalSamples+=temporal.samples.length;
      return{...temporal,backend:'composition-canvas2d-temporal',plan,canvas:target,fidelity:this.lastFidelity};
    }
    if(this.gpuRenderer?.supports?.(plan)){
      try{
        const target=surfaceCanvas(container,'webgpu',this.canvasFactory);
        if(!target)throw new Error('GPU composition target is unavailable');
        target.width=plan.width;target.height=plan.height;
        const gpu=await this.gpuRenderer.present(target,plan,{assetResolver,frameProvider,priority,signal,fidelity:this.lastFidelity,shouldCommit:()=>generation===this.generation});
        if(gpu?.stale){this.metrics.stale++;return{stale:true,plan,result:gpu,fidelity:this.lastFidelity};}
        showSurface(container,'webgpu');this.metrics.presented++;this.metrics.gpu++;
        return{...gpu,plan,canvas:target,fidelity:this.lastFidelity};
      }catch(error){if(error?.name==='AbortError')throw error;/* preserve Canvas2D as deterministic fallback */}
    }
    const scratch=this.canvasFactory();
    const result=await this.renderer(scratch,plan,{assetResolver,frameProvider,priority,signal,fidelity:this.lastFidelity});
    if(generation!==this.generation){this.metrics.stale++;return{stale:true,plan,result,fidelity:this.lastFidelity};}
    const target=surfaceCanvas(container,'canvas2d',this.canvasFactory);
    if(!target)throw new Error('Composition playback target is unavailable');
    target.width=plan.width;target.height=plan.height;
    const context=target.getContext?.('2d');
    if(!context)throw new Error('Composition playback target requires Canvas2D');
    context.clearRect(0,0,target.width,target.height);context.drawImage(scratch,0,0,target.width,target.height);
    const intrinsic=plan.visual.some((item)=>item.kind==='text'||item.kind==='shape');
    const sourceItems=plan.visual.filter((item)=>item.assetId);
    const allSourcesFailed=sourceItems.length>0&&result?.errors?.length>=sourceItems.length;
    if(allSourcesFailed&&!intrinsic){showSurface(container,null);this.metrics.fallback++;return{backend:'fallback',plan,result,fidelity:this.lastFidelity};}
    showSurface(container,'canvas2d');this.metrics.presented++;this.metrics.canvas2d++;
    return{backend:'composition-canvas2d',plan,result,canvas:target,fidelity:this.lastFidelity};
  }
  showFallback(container){this.invalidate();showSurface(container,null);}
  stats(){return{...this.metrics,staleFrameRatio:(this.metrics.presented+this.metrics.stale)?this.metrics.stale/(this.metrics.presented+this.metrics.stale):0,fidelity:this.lastFidelity};}
  clear(){this.invalidate();this.lastFidelity=null;this.frameProvider.clear?.();this.gpuRenderer?.clear?.();}
  close(){this.invalidate();this.lastFidelity=null;if(typeof this.frameProvider?.close==='function')this.frameProvider.close();else this.frameProvider?.clear?.();this.gpuRenderer?.clear?.();}
}
