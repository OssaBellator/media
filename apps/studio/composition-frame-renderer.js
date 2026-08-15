import { evaluateComposition } from '../../packages/core/src/evaluation.js';
import { shouldTemporalAccumulate } from '../../packages/core/src/fidelity-render.js';
import { scaleRenderPlan } from '../../packages/core/src/render-scale.js';
import { renderPlanToCanvas2D } from './render-engine.js';
import { renderTemporalCompositionToCanvas2D } from './temporal-composition-renderer.js';

function createCanvas(){if(typeof OffscreenCanvas==='function')return new OffscreenCanvas(1,1);const canvas=globalThis.document?.createElement?.('canvas');if(!canvas)throw new Error('Composition frame rendering requires a canvas implementation');return canvas;}
function positive(value,fallback){const number=Number(value);return Number.isFinite(number)&&number>0?number:fallback;}

export class CompositionFrameRenderer{
  constructor({evaluate=evaluateComposition,scalePlan=scaleRenderPlan,renderer=renderPlanToCanvas2D,temporalRenderer=renderTemporalCompositionToCanvas2D,frameProvider,canvasFactory=createCanvas}={}){if(!frameProvider)throw new Error('CompositionFrameRenderer requires frameProvider');this.evaluate=evaluate;this.scalePlan=scalePlan;this.renderer=renderer;this.temporalRenderer=temporalRenderer;this.frameProvider=frameProvider;this.canvasFactory=canvasFactory;}
  async render(graph,time,{compositionId,width=null,height=null,fidelity={mode:'export',resolutionScale:1,temporalSamples:8,vectorSupersample:4},priority=100,signal}={}){
    const evaluated=this.evaluate(graph,{compositionId,time}),targetWidth=Math.max(1,Math.round(positive(width,evaluated.width))),targetHeight=Math.max(1,Math.round(positive(height,evaluated.height))),scaleOptions={maxWidth:targetWidth,maxHeight:targetHeight,maxPixels:targetWidth*targetHeight,allowUpscale:true},assetResolver=(id)=>graph.nodes[id],scratch=this.canvasFactory();
    let result,plan;
    if(shouldTemporalAccumulate(evaluated,fidelity)){
      result=await this.temporalRenderer(scratch,graph,evaluated,{evaluate:this.evaluate,scalePlan:this.scalePlan,scaleOptions,renderer:this.renderer,assetResolver,frameProvider:this.frameProvider,priority,signal,fidelity,canvasFactory:this.canvasFactory});
      plan=this.scalePlan({...evaluated,fidelity},scaleOptions);
    }else{
      plan=this.scalePlan({...evaluated,fidelity},scaleOptions);
      result=await this.renderer(scratch,plan,{assetResolver,frameProvider:this.frameProvider,priority,signal,fidelity,canvasFactory:this.canvasFactory});
    }
    const canvas=this.canvasFactory();canvas.width=targetWidth;canvas.height=targetHeight;const context=canvas.getContext?.('2d');if(!context)throw new Error('Composition frame output requires Canvas2D');context.clearRect?.(0,0,targetWidth,targetHeight);context.drawImage(scratch,0,0,targetWidth,targetHeight);
    return{canvas,plan,evaluated,result,fidelity,temporal:Boolean(result?.samples?.length>1)};
  }
  async frameAt(graph,time,options={}){return(await this.render(graph,time,options)).canvas;}
}

export function createCompositionFrameRenderer(options){return new CompositionFrameRenderer(options);}
