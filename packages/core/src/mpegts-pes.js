const PTS_WRAP=2**33;
function concat(chunks,total){const out=new Uint8Array(total);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length;}return out;}
export function decodePesTimestamp(bytes,offset=0){
  if(offset+5>bytes.length)throw new Error('Incomplete PES timestamp');
  return ((bytes[offset]&0x0e)*536870912)+(bytes[offset+1]*4194304)+((bytes[offset+2]&0xfe)*16384)+(bytes[offset+3]*128)+((bytes[offset+4]&0xfe)>>1);
}
export class TimestampUnwrapper{
  constructor({lastRaw=null,epoch=0}={}){this.lastRaw=lastRaw;this.epoch=epoch;}
  reset(){this.lastRaw=null;this.epoch=0;}
  unwrap(raw){raw=Number(raw);if(this.lastRaw!=null){const delta=raw-this.lastRaw;if(delta<-(PTS_WRAP/2))this.epoch++;else if(delta>(PTS_WRAP/2))this.epoch--;}this.lastRaw=raw;return raw+this.epoch*PTS_WRAP;}
  snapshot(){return{lastRaw:this.lastRaw,epoch:this.epoch};}
}
export function parsePesPacket(bytes,{ptsUnwrapper=null,dtsUnwrapper=null}={}){
  const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  if(data.length<9||data[0]!==0||data[1]!==0||data[2]!==1)throw new Error('Invalid PES start code');
  const streamId=data[3],packetLength=(data[4]<<8)|data[5],flags2=data[7],headerLength=data[8],payloadOffset=9+headerLength;
  if(payloadOffset>data.length)throw new Error('Invalid PES header length');
  const ptsDtsFlags=(flags2>>6)&3;let ptsRaw=null,dtsRaw=null;
  if(ptsDtsFlags===2||ptsDtsFlags===3)ptsRaw=decodePesTimestamp(data,9);
  if(ptsDtsFlags===3)dtsRaw=decodePesTimestamp(data,14);
  const pts=ptsRaw==null?null:(ptsUnwrapper?.unwrap(ptsRaw)??ptsRaw),dts=dtsRaw==null?(pts==null?null:pts):(dtsUnwrapper?.unwrap(dtsRaw)??dtsRaw);
  return {streamId,packetLength,ptsRaw,dtsRaw,pts,dts,payload:data.subarray(payloadOffset),headerLength};
}
export class PesAssembler{
  constructor(){this.pending=new Map();}
  reset(pid=null){if(pid==null)this.pending.clear();else this.pending.delete(pid);}
  push(packet){
    if(!packet.hasPayload||!packet.payload.length)return[];
    const out=[];let state=this.pending.get(packet.pid);
    if(packet.payloadUnitStart){if(state?.length)out.push({pid:packet.pid,bytes:concat(state.chunks,state.length)});state={chunks:[],length:0};}
    if(!state)state={chunks:[],length:0};state.chunks.push(packet.payload.slice());state.length+=packet.payload.length;this.pending.set(packet.pid,state);return out;
  }
  flush(pid=null){const out=[];for(const [key,state] of [...this.pending]){if(pid!=null&&key!==pid)continue;if(state.length)out.push({pid:key,bytes:concat(state.chunks,state.length)});this.pending.delete(key);}return out;}
}
export function ticksToMicros(ticks){return ticks==null?null:Math.round(Number(ticks)*1_000_000/90_000);}
