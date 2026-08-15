import { temporalSamplesForFidelity } from '../../packages/core/src/fidelity-render.js';
import { accumulateTemporalFrames } from '../../packages/core/src/temporal-accumulation.js';

function createCanvas(){if(typeof OffscreenCanvas==='function')return new OffscreenCanvas(1,1);const canvas=globalThis.document?.createElement?.('canvas');if(!canvas)throw new Error('Temporal composition rendering requires a canvas implementation');return canvas;}
function abortError(){if(typeof DOMException==='function')return new DOMException('Temporal composition render aborted','AbortError');const error=new Error('Temporal composition render aborted');error.name='AbortError';return error;}
function imageBytes(canvas){const context=canvas.getContext?.('2d');if(!context?.getImageData)throw new Error('Temporal accumulation requires Canvas2D pixel readback');return new Uint8Array(context.getImageData(0,0,canvas.width,canvas.height).data);}
function putBytes(canvas,width,height,bytes){canvas.width=width;canvas.height=height;const context=canvas.getContext?.('2d');if(!context)throw new Error('Temporal accumulation requires Canvas2D');const image=context.createImageData?.(width,height)??context.getImageData?.(0,0,width,height);if(!image?.data)throw new Error('Temporal accumulation requires ImageData access');image.data.set(bytes);context.putImageData(image,0,0);}

export async function renderTemporalCompositionToCanvas2D(canvas,graph,evaluated,{
  evaluate,
  scalePlan=(plan)=>plan,
  scaleOptions={},
  renderer,
  assetResolver,
  frameProvider,
  fidelity={},
  priority=0,
  signal,
  canvasFactory=createCanvas,
  onSample,
}={}){
  if(typeof evaluate!=='function')throw new Error('Temporal composition rendering requires evaluate');
  if(typeof renderer!=='function')throw new Error('Temporal composition rendering requires renderer');
  const samples=temporalSamplesForFidelity(evaluated,fidelity);
  if(samples.length<2)throw new Error('Temporal composition rendering requires more than one sample');
  const frames=[],sampleResults=[];
  let outputPlan=null;
  for(const sample of samples){
    if(signal?.aborted)throw abortError();
    const sampleEvaluated=Math.abs(sample.time-Number(evaluated.time))<=1e-9?evaluated:evaluate(graph,{compositionId:evaluated.compositionId,time:sample.time});
    const plan=scalePlan({...sampleEvaluated,fidelity:{...fidelity,temporalSample:sample}},scaleOptions);
    if(outputPlan&&(plan.width!==outputPlan.width||plan.height!==outputPlan.height))throw new Error('Temporal sample dimensions must match');
    outputPlan??=plan;
    const scratch=canvasFactory();
    const result=await renderer(scratch,plan,{assetResolver,frameProvider,priority,signal,fidelity:{...fidelity,temporalSample:sample}});
    if(signal?.aborted)throw abortError();
    frames.push(imageBytes(scratch));
    sampleResults.push({sample,plan,result});
    onSample?.({sample,plan,result,index:sampleResults.length-1,total:samples.length});
  }
  const pixels=accumulateTemporalFrames(frames,samples,{output:'uint8'});
  putBytes(canvas,outputPlan.width,outputPlan.height,pixels);
  return{
    backend:'composition-canvas2d-temporal',
    canvas,
    plan:outputPlan,
    samples,
    sampleResults,
    errors:sampleResults.flatMap(({result})=>result?.errors??[]),
  };
}
