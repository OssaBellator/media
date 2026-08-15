function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
function boundedScale(value,fallback=1){const number=Number(value);return Number.isFinite(number)&&number>0?number:fallback;}

export function resolveCompositionFps(graph,evaluated,{fps=null,defaultFps=30}={}){
  const explicit=Number(fps);
  if(explicit>0)return explicit;
  const node=graph?.nodes?.[evaluated?.compositionId],fromNode=Number(node?.props?.fps);
  if(fromNode>0)return fromNode;
  const fromPlan=Number(evaluated?.fps);
  return fromPlan>0?fromPlan:defaultFps;
}

export class FidelityController{
  constructor({
    utilization=.72,
    ewmaAlpha=.2,
    maxTemporalSamples=8,
    maxVectorSupersample=4,
    minTemporalSamples=1,
    minVectorSupersample=1,
    minResolutionScale=.5,
    maxResolutionScale=1,
    scrubResolutionScale=.5,
  }={}){
    this.utilization=clamp(Number(utilization)||.72,.1,1);
    this.alpha=clamp(Number(ewmaAlpha)||.2,.01,1);
    this.maxTemporalSamples=Math.max(1,Math.round(maxTemporalSamples));
    this.maxVectorSupersample=Math.max(1,Math.round(maxVectorSupersample));
    this.minTemporalSamples=Math.max(1,Math.round(minTemporalSamples));
    this.minVectorSupersample=Math.max(1,Math.round(minVectorSupersample));
    this.minResolutionScale=clamp(boundedScale(minResolutionScale,.5),.25,1);
    this.maxResolutionScale=clamp(boundedScale(maxResolutionScale,1),this.minResolutionScale,1);
    this.scrubResolutionScale=clamp(boundedScale(scrubResolutionScale,this.minResolutionScale),this.minResolutionScale,this.maxResolutionScale);
    this.reset();
  }
  plan({mode='playback',fps=30,requestedTemporalSamples=this.maxTemporalSamples,requestedVectorSupersample=this.maxVectorSupersample}={}){
    fps=Math.max(1,Number(fps)||30);
    if(mode==='scrub')return{mode,fps,frameBudgetMs:1000/fps,temporalSamples:1,vectorSupersample:1,resolutionScale:this.scrubResolutionScale};
    if(mode==='export')return{mode,fps,frameBudgetMs:Infinity,temporalSamples:Math.max(1,Math.round(requestedTemporalSamples)),vectorSupersample:Math.max(1,Math.round(requestedVectorSupersample)),resolutionScale:1};
    const budget=1000/fps*this.utilization;
    const observed=this.renderMs??budget/2;
    const ratio=clamp(budget/Math.max(.1,observed),.2,2);
    const stalePenalty=clamp(1-this.stalePressure,0.25,1);
    const quality=ratio*stalePenalty;
    const temporal=clamp(Math.floor(Math.max(1,requestedTemporalSamples)*quality),this.minTemporalSamples,this.maxTemporalSamples);
    const vector=clamp(Math.round(Math.max(1,requestedVectorSupersample)*Math.sqrt(quality)),this.minVectorSupersample,this.maxVectorSupersample);
    const resolutionScale=clamp(Math.sqrt(Math.max(.05,quality)),this.minResolutionScale,this.maxResolutionScale);
    return{mode,fps,frameBudgetMs:budget,temporalSamples:temporal,vectorSupersample:vector,resolutionScale,estimatedRenderMs:observed,stalePressure:this.stalePressure};
  }
  record({durationMs,stale=false}={}){
    const ms=Math.max(0,Number(durationMs)||0);
    this.renderMs=this.renderMs==null?ms:this.renderMs+(ms-this.renderMs)*this.alpha;
    this.stalePressure=this.stalePressure+(Number(Boolean(stale))-this.stalePressure)*this.alpha;
    this.frames++;
    if(stale)this.stale++;
    return this.snapshot();
  }
  reset(){this.renderMs=null;this.stale=0;this.frames=0;this.stalePressure=0;return this.snapshot();}
  snapshot(){return{renderMs:this.renderMs,frames:this.frames,stale:this.stale,staleRatio:this.frames?this.stale/this.frames:0,stalePressure:this.stalePressure};}
}
