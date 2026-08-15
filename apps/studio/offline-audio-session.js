function abortError(){if(typeof DOMException==='function')return new DOMException('Audio render aborted','AbortError');const error=new Error('Audio render aborted');error.name='AbortError';return error;}
export class OfflineAudioSession {
  constructor({createPlan,decodeAsset,renderMix,analyze=null,normalize=null}={}){
    if(typeof createPlan!=='function')throw new Error('OfflineAudioSession requires createPlan');
    if(typeof decodeAsset!=='function')throw new Error('OfflineAudioSession requires decodeAsset');
    if(typeof renderMix!=='function')throw new Error('OfflineAudioSession requires renderMix');
    this.createPlan=createPlan;this.decodeAsset=decodeAsset;this.renderMix=renderMix;this.analyze=analyze;this.normalize=normalize;
    this.metrics={renders:0,decodedAssets:0,failures:0,normalized:0};
  }
  async render(graph,output,{start,end,sampleRate=48000,signal}={}){
    if(signal?.aborted)throw signal.reason??abortError();
    this.metrics.renders++;
    const plan=this.createPlan(graph,{start,end,sampleRate,blockSize:1024});
    if(!plan.sources?.length)return null;
    const sources=new Map();
    try{
      for(const assetId of new Set(plan.sources.map((item)=>item.assetId))){
        if(signal?.aborted)throw signal.reason??abortError();
        const decoded=await this.decodeAsset(graph,plan,assetId,{signal});
        if(!decoded||!(Number(decoded.sampleRate)>0))throw new Error(`Audio source ${assetId} could not be decoded`);
        sources.set(assetId,decoded);this.metrics.decodedAssets++;
      }
      const clipAutomation={};
      for(const item of plan.sources){const clip=graph.nodes?.[item.clipId];if(clip?.props?.audioAutomation)clipAutomation[item.clipId]=clip.props.audioAutomation;}
      let pcm=this.renderMix(plan,sources,{channels:2,clipAutomation,masterAutomation:output?.props?.audioAutomation??{}});
      const before=this.analyze?.(pcm)??null,target=Number(output?.props?.loudnessTargetLufs);
      if(Number.isFinite(target)&&this.normalize){const normalized=this.normalize(pcm,{targetLufs:target,maxTruePeakDbfs:Number(output?.props?.maxTruePeakDbfs??-1)});pcm=normalized.buffer;pcm.loudness={before,after:normalized.after,gainDb:normalized.gainDb};this.metrics.normalized++;}
      else if(before)pcm.loudness={before};
      return pcm;
    }catch(error){this.metrics.failures++;throw error;}
  }
  stats(){return{...this.metrics};}
}
