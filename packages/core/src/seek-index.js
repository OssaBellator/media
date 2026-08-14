function finite(value,label){const parsed=Number(value);if(!Number.isFinite(parsed))throw new Error(`${label} must be finite`);return parsed;}
export function createSeekIndex(chunks,{timescale=1_000_000}={}){
  const scale=finite(timescale,'timescale');if(scale<=0)throw new Error('timescale must be positive');
  const tracks=new Map();
  for(const chunk of chunks){if(!chunk?.trackId)throw new Error('Chunk missing trackId');const list=tracks.get(chunk.trackId)??[];list.push({...chunk,time:Number(chunk.timestamp)/scale,endTime:(Number(chunk.timestamp)+Number(chunk.duration??0))/scale});tracks.set(chunk.trackId,list);}
  const result={version:1,timescale:scale,tracks:{}};
  for(const [trackId,list] of tracks){list.sort((a,b)=>a.timestamp-b.timestamp);result.tracks[trackId]={chunks:list,keyframes:list.filter((chunk)=>chunk.type==='key').map((chunk)=>({time:chunk.time,timestamp:chunk.timestamp,sequence:chunk.sequence,offset:chunk.offset}))};}
  return result;
}
export function nearestKeyframe(index,trackId,time,{direction='backward'}={}){
  const track=index.tracks[trackId];if(!track)throw new Error(`Unknown seek track: ${trackId}`);const target=Math.max(0,finite(time,'time'));const frames=track.keyframes;if(!frames.length)return null;
  if(direction==='forward')return frames.find((frame)=>frame.time>=target)??frames.at(-1);
  if(direction==='nearest')return [...frames].sort((a,b)=>Math.abs(a.time-target)-Math.abs(b.time-target))[0];
  let match=frames[0];for(const frame of frames){if(frame.time>target)break;match=frame;}return match;
}
export function decodeWindowFromSeekIndex(index,trackId,{time=0,ahead=2,behind=.25}={}){
  const track=index.tracks[trackId];if(!track)throw new Error(`Unknown seek track: ${trackId}`);const target=Math.max(0,finite(time,'time'));const start=Math.max(0,target-Math.max(0,finite(behind,'behind')));const end=target+Math.max(0,finite(ahead,'ahead'));const key=nearestKeyframe(index,trackId,start,{direction:'backward'});const decodeStart=key?.time??start;return{trackId,target,start:decodeStart,end,chunks:track.chunks.filter((chunk)=>chunk.time<end&&chunk.endTime>=decodeStart)};
}
export function prefetchWindows(index,trackIds,{time=0,direction=1,horizon=4,behind=.25}={}){const lead=Math.max(0,finite(horizon,'horizon'));const target=Math.max(0,finite(time,'time'));return trackIds.map((trackId)=>decodeWindowFromSeekIndex(index,trackId,{time:target,ahead:direction>=0?lead:behind,behind:direction>=0?behind:lead}));}
