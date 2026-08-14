function finite(value,label){const n=Number(value);if(!Number.isFinite(n))throw new Error(`${label} must be finite`);return n;}
function ease(name,t){if(name==='hold')return 0;if(name==='ease-in')return t*t;if(name==='ease-out')return 1-(1-t)*(1-t);if(name==='ease-in-out')return t<.5?2*t*t:1-((-2*t+2)**2)/2;return t;}
export function normalizeAutomationCurve(points,{defaultValue=0}={}){if(!Array.isArray(points)||!points.length)return[{time:0,value:finite(defaultValue,'defaultValue'),easing:'linear'}];const sorted=points.map((p)=>({time:Math.max(0,finite(p.time,'automation time')),value:finite(p.value,'automation value'),easing:p.easing??'linear'})).sort((a,b)=>a.time-b.time);const dedup=[];for(const point of sorted){if(dedup.at(-1)?.time===point.time)dedup[dedup.length-1]=point;else dedup.push(point);}return dedup;}
export function automationValueAt(points,time,{defaultValue=0}={}){const curve=normalizeAutomationCurve(points,{defaultValue});const t=Math.max(0,finite(time,'time'));if(t<=curve[0].time)return curve[0].value;if(t>=curve.at(-1).time)return curve.at(-1).value;for(let i=0;i<curve.length-1;i++){const a=curve[i],b=curve[i+1];if(t<a.time||t>b.time)continue;const ratio=(t-a.time)/(b.time-a.time||1);const mix=ease(a.easing,ratio);return a.value+(b.value-a.value)*mix;}return curve.at(-1).value;}
export function dbToLinearAutomation(db){const value=finite(db,'dB');return value<=-120?0:10**(value/20);}
export function applyGainAutomation(buffer,points,{startTime=0}={}){const sampleRate=finite(buffer.sampleRate,'sampleRate');for(let frame=0;frame<buffer.length;frame++){const time=startTime+frame/sampleRate;const gain=dbToLinearAutomation(automationValueAt(points,time));for(const channel of buffer.channels)channel[frame]*=gain;}return buffer;}
export function applyPanAutomation(buffer,points,{startTime=0}={}){if(buffer.channels.length<2)return buffer;const sampleRate=finite(buffer.sampleRate,'sampleRate');for(let frame=0;frame<buffer.length;frame++){const time=startTime+frame/sampleRate;const pan=Math.max(-1,Math.min(1,automationValueAt(points,time)));const angle=(pan+1)*Math.PI/4;buffer.channels[0][frame]*=Math.cos(angle);buffer.channels[1][frame]*=Math.sin(angle);}return buffer;}
export function applyAutomationBundle(buffer,{gainDb=[],pan=[]}={},options={}){if(gainDb?.length)applyGainAutomation(buffer,gainDb,options);if(pan?.length)applyPanAutomation(buffer,pan,options);return buffer;}
export function automationRange(points,{start=0,end}={}){const curve=normalizeAutomationCurve(points);const stop=end==null?curve.at(-1).time:Math.max(start,Number(end));return curve.filter((point)=>point.time>=start&&point.time<=stop);}

export function setClipAudioAutomationOperations(graph,clipId,property,points){
  if(!['gainDb','pan'].includes(property))throw new Error(`Unsupported clip audio automation property: ${property}`);
  const clip=graph?.nodes?.[clipId];if(!clip||clip.kind!=='clip')throw new Error(`Unknown clip: ${clipId}`);
  const track=graph.nodes[clip.props.trackId];if(track?.props?.mediaKind!=='audio')throw new Error(`Clip ${clipId} is not on an audio track`);if(track.props.locked)throw new Error(`Track ${track.name} is locked`);
  const curve=normalizeAutomationCurve(points,{defaultValue:property==='gainDb'?0:0});
  if(property==='gainDb')for(const point of curve)point.value=Math.max(-120,Math.min(24,point.value));else for(const point of curve)point.value=Math.max(-1,Math.min(1,point.value));
  return[{type:'node.update',nodeId:clipId,patch:{props:{audioAutomation:{...(clip.props.audioAutomation??{}),[property]:curve}}}}];
}
export function setOutputAudioAutomationOperations(graph,outputId,property,points){
  if(property!=='gainDb')throw new Error(`Unsupported output audio automation property: ${property}`);const output=graph?.nodes?.[outputId];if(!output||output.kind!=='output')throw new Error(`Unknown output: ${outputId}`);const curve=normalizeAutomationCurve(points,{defaultValue:0});for(const point of curve)point.value=Math.max(-120,Math.min(24,point.value));return[{type:'node.update',nodeId:outputId,patch:{props:{audioAutomation:{...(output.props.audioAutomation??{}),gainDb:curve}}}}];
}
