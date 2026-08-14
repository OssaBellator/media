const CONTAINERS=new Set(['mp4','webm','wav']);
function finite(value,label){const parsed=Number(value);if(!Number.isFinite(parsed))throw new Error(`${label} must be finite`);return parsed;}
export function createMuxTrack({id,type,codec,timescale=1_000_000,config={}}={}){if(!id||!type||!codec)throw new Error('Mux track requires id, type and codec');const scale=finite(timescale,'timescale');if(scale<=0)throw new Error('timescale must be positive');return{id:String(id),type:String(type),codec:String(codec),timescale:scale,config:structuredClone(config)};}
export function interleaveMuxSamples(samples){return [...samples].sort((a,b)=>Number(a.dts??a.timestamp??0)-Number(b.dts??b.timestamp??0)||Number(a.trackOrder??0)-Number(b.trackOrder??0)||Number(a.sequence??0)-Number(b.sequence??0));}
export function createMuxPlan({container,tracks=[],samples=[],metadata={}}={}){
  if(!CONTAINERS.has(container))throw new Error(`Unsupported mux container: ${container}`);if(!tracks.length)throw new Error('Mux plan requires tracks');
  const trackMap=new Map();tracks.forEach((track,index)=>{if(trackMap.has(track.id))throw new Error(`Duplicate mux track: ${track.id}`);trackMap.set(track.id,{...track,order:index});});
  const normalized=samples.map((sample,index)=>{const track=trackMap.get(sample.trackId);if(!track)throw new Error(`Mux sample references unknown track: ${sample.trackId}`);return{trackId:sample.trackId,trackOrder:track.order,sequence:Number(sample.sequence??index),timestamp:Math.max(0,finite(sample.timestamp??0,'timestamp')),dts:Math.max(0,finite(sample.dts??sample.timestamp??0,'dts')),duration:Math.max(0,finite(sample.duration??0,'duration')),keyframe:Boolean(sample.keyframe??sample.type==='key'),byteLength:Math.max(0,Math.round(finite(sample.byteLength??0,'byteLength'))),payload:sample.payload??null};});
  const byTrack=new Map();for(const sample of normalized){const prev=byTrack.get(sample.trackId);if(prev&&sample.dts<prev.dts)throw new Error(`Non-monotonic DTS for track ${sample.trackId}`);byTrack.set(sample.trackId,sample);}
  const ordered=interleaveMuxSamples(normalized);const duration=ordered.reduce((max,sample)=>Math.max(max,sample.timestamp+sample.duration),0)/1_000_000;
  return{version:1,container,tracks:tracks.map((track)=>structuredClone(track)),samples:ordered,duration,metadata:structuredClone(metadata)};
}
export function segmentMuxPlan(plan,{segmentDuration=2,alignVideoKeyframes=true}={}){
  const duration=Math.max(.001,finite(segmentDuration,'segmentDuration'));const micros=duration*1_000_000;const segments=[];let current=[];let boundary=micros;
  const videoTrackIds=new Set(plan.tracks.filter((track)=>track.type==='video').map((track)=>track.id));
  const flush=()=>{if(!current.length)return;segments.push({index:segments.length,start:current[0].timestamp/1_000_000,end:Math.max(...current.map((s)=>(s.timestamp+s.duration)/1_000_000)),samples:current});current=[];};
  for(const sample of plan.samples){const isBoundary=sample.timestamp>=boundary;const canSplit=!alignVideoKeyframes||!videoTrackIds.size||(videoTrackIds.has(sample.trackId)&&sample.keyframe);if(isBoundary&&canSplit){flush();while(boundary<=sample.timestamp)boundary+=micros;}current.push(sample);}flush();return segments;
}
export function muxByteEstimate(plan,{overheadRatio=.015}={}){const payload=plan.samples.reduce((sum,sample)=>sum+sample.byteLength,0);return Math.ceil(payload*(1+Math.max(0,Number(overheadRatio)||0)));}
