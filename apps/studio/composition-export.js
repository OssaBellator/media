import { renderProgressiveTimelineExport, renderTimelineExport } from './deliver-runtime.js';
import { CompositionFrameRenderer } from './composition-frame-renderer.js';

function exportFidelity(manifest,{temporalSamples=8,vectorSupersample=4}={}){return{mode:'export',fps:Number(manifest?.settings?.fps)||30,resolutionScale:1,temporalSamples:Math.max(1,Math.round(Number(temporalSamples)||1)),vectorSupersample:Math.max(1,Math.round(Number(vectorSupersample)||1))};}
export async function renderCompositionTimelineExport({graph,compositionId,manifest,frameProvider,frameRenderer=null,frameRendererOptions={},temporalSamples=8,vectorSupersample=4,progressive=false,exporter=null,...exportOptions}={}){
  if(!graph?.nodes)throw new Error('Composition export requires graph');if(!manifest?.settings)throw new Error('Composition export requires manifest');const renderer=frameRenderer??new CompositionFrameRenderer({...frameRendererOptions,frameProvider}),fidelity=exportFidelity(manifest,{temporalSamples,vectorSupersample}),renderFrame=(time)=>renderer.frameAt(graph,time,{compositionId,width:manifest.settings.width,height:manifest.settings.height,fidelity,signal:exportOptions.signal}),run=exporter??(progressive?renderProgressiveTimelineExport:renderTimelineExport);return run({manifest,renderFrame,...exportOptions});
}
