function abortError(message='Delivery cancelled'){
  if(typeof DOMException==='function')return new DOMException(message,'AbortError');
  const error=new Error(message);error.name='AbortError';return error;
}
function outputNode(graph,outputId){const output=graph?.nodes?.[outputId];if(!output||output.kind!=='output')throw new Error(`Unknown output: ${outputId}`);return output;}
export function deliveryCodecOptions(output,container,{hasAudio=false}={}){
  const width=Math.max(1,Number(output?.props?.width)||1),height=Math.max(1,Number(output?.props?.height)||1),fps=Math.max(1,Number(output?.props?.fps)||30),mp4=container==='mp4';
  if(!['mp4','webm'].includes(container))throw new Error(`Unsupported delivery container: ${container}`);
  return{
    videoConfig:mp4?{codec:'avc1.640028',width,height,framerate:fps,bitrate:Math.max(1_000_000,width*height*4),avc:{format:'avc'}}:{codec:'vp09.00.10.08',width,height,framerate:fps,bitrate:Math.max(800_000,width*height*3)},
    audioConfig:hasAudio?(mp4?{codec:'mp4a.40.2',sampleRate:48000,numberOfChannels:2,bitrate:192000}:{codec:'opus',sampleRate:48000,numberOfChannels:2,bitrate:160000}):null,
  };
}
export class CompositionDeliverySession {
  constructor({createManifest,createFrameRenderer,renderExport,renderOfflineAudio=null,audioPlanForOutput=null}={}){
    if(typeof createManifest!=='function')throw new Error('CompositionDeliverySession requires createManifest');
    if(typeof createFrameRenderer!=='function')throw new Error('CompositionDeliverySession requires createFrameRenderer');
    if(typeof renderExport!=='function')throw new Error('CompositionDeliverySession requires renderExport');
    this.createManifest=createManifest;this.createFrameRenderer=createFrameRenderer;this.renderExport=renderExport;this.renderOfflineAudio=renderOfflineAudio;this.audioPlanForOutput=audioPlanForOutput;
    this.controllers=new Map();this.metrics={renders:0,completed:0,cancelled:0,failed:0,rendersWithAudio:0,progressive:0};
  }
  async render(graph,outputId,{container,progressive=false,sink=null,temporalSamples=8,vectorSupersample=4,onProgress,signal,...options}={}){
    const output=outputNode(graph,outputId),resolvedContainer=container??(output.props.format==='webm'?'webm':'mp4');
    if(!['mp4','webm'].includes(resolvedContainer))throw new Error(`Output ${output.name} cannot render to ${resolvedContainer}`);
    if(progressive&&!sink)throw new Error('Progressive delivery requires a sink');
    const controller=new AbortController(),relay=()=>controller.abort(signal?.reason??abortError());
    if(signal){if(signal.aborted)relay();else signal.addEventListener('abort',relay,{once:true});}
    this.cancel(outputId);this.controllers.set(outputId,controller);this.metrics.renders++;if(progressive)this.metrics.progressive++;
    let frameRenderer=null;
    try{
      const manifest=this.createManifest(graph,outputId),audioPlan=this.audioPlanForOutput?.(graph,output),hasAudio=output.props.includeAudio!==false&&Boolean(audioPlan?.sources?.length),codecs=deliveryCodecOptions(output,resolvedContainer,{hasAudio});
      const renderAudioPcm=hasAudio&&this.renderOfflineAudio?({start,end,sampleRate,signal})=>this.renderOfflineAudio(graph,output,{start,end,sampleRate,signal}):null;
      if(hasAudio&&!renderAudioPcm)throw new Error('Output contains audio but no offline audio renderer is configured');
      frameRenderer=this.createFrameRenderer(graph,output);
      if(hasAudio)this.metrics.rendersWithAudio++;
      const result=await this.renderExport({graph,compositionId:output.props.compositionId,manifest,frameRenderer,temporalSamples,vectorSupersample,progressive,container:resolvedContainer,sink,signal:controller.signal,renderAudioPcm,...codecs,onProgress,...options});
      this.metrics.completed++;return{...result,manifest,outputId,container:resolvedContainer,hasAudio};
    }catch(error){if(error?.name==='AbortError')this.metrics.cancelled++;else this.metrics.failed++;throw error;}
    finally{if(this.controllers.get(outputId)===controller)this.controllers.delete(outputId);signal?.removeEventListener?.('abort',relay);frameRenderer?.close?.();}
  }
  cancel(outputId){const controller=this.controllers.get(outputId);if(controller){controller.abort(abortError());this.controllers.delete(outputId);return true;}return false;}
  cancelAll(){for(const id of [...this.controllers.keys()])this.cancel(id);}
  stats(){return{...this.metrics,active:this.controllers.size};}
  close(){this.cancelAll();}
}
