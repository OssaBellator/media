export const MPEG_TS_PACKET_SIZE = 188;
export const MPEG_TS_CLOCK = 90_000;

export function findTsSyncOffset(bytes,{maxPackets=5}={}){
  const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes??0);
  const limit=Math.min(MPEG_TS_PACKET_SIZE,data.length);
  for(let offset=0;offset<limit;offset++){
    if(data[offset]!==0x47)continue;
    let ok=0;
    for(let i=offset;i<data.length&&ok<maxPackets;i+=MPEG_TS_PACKET_SIZE){if(data[i]!==0x47)break;ok++;}
    if(ok>=Math.min(2,Math.floor((data.length-offset)/MPEG_TS_PACKET_SIZE)))return offset;
  }
  return -1;
}

function parsePcr(data,offset){
  const base=(BigInt(data[offset])<<25n)|(BigInt(data[offset+1])<<17n)|(BigInt(data[offset+2])<<9n)|(BigInt(data[offset+3])<<1n)|BigInt(data[offset+4]>>7);
  const extension=((data[offset+4]&1)<<8)|data[offset+5];
  return {base:Number(base),extension,seconds:(Number(base)+extension/300)/90_000};
}

export function parseTsPacket(bytes,offset=0){
  const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  if(offset<0||offset+MPEG_TS_PACKET_SIZE>data.length)throw new Error('Incomplete MPEG-TS packet');
  if(data[offset]!==0x47)throw new Error(`Invalid MPEG-TS sync byte at ${offset}`);
  const b1=data[offset+1],b2=data[offset+2],b3=data[offset+3];
  const transportError=Boolean(b1&0x80),payloadUnitStart=Boolean(b1&0x40),transportPriority=Boolean(b1&0x20),pid=((b1&0x1f)<<8)|b2;
  const scramblingControl=(b3>>6)&3,adaptationFieldControl=(b3>>4)&3,continuityCounter=b3&0xf;
  let cursor=offset+4,adaptation=null;
  if(adaptationFieldControl===2||adaptationFieldControl===3){
    const length=data[cursor++];
    if(cursor+length>offset+MPEG_TS_PACKET_SIZE)throw new Error('Invalid MPEG-TS adaptation field length');
    if(length){
      const flags=data[cursor],pcrFlag=Boolean(flags&0x10),discontinuityIndicator=Boolean(flags&0x80),randomAccessIndicator=Boolean(flags&0x40);
      adaptation={length,flags,pcrFlag,discontinuityIndicator,randomAccessIndicator,pcr:pcrFlag&&length>=7?parsePcr(data,cursor+1):null};
    }else adaptation={length:0,flags:0,pcrFlag:false,discontinuityIndicator:false,randomAccessIndicator:false,pcr:null};
    cursor+=length;
  }
  const hasPayload=adaptationFieldControl===1||adaptationFieldControl===3;
  const payload=hasPayload&&cursor<offset+MPEG_TS_PACKET_SIZE?data.subarray(cursor,offset+MPEG_TS_PACKET_SIZE):new Uint8Array();
  return {offset,pid,transportError,payloadUnitStart,transportPriority,scramblingControl,adaptationFieldControl,continuityCounter,adaptation,hasPayload,payload};
}

export class TsContinuityTracker{
  constructor(){this.last=new Map();this.errors=[];}
  reset(pid=null){if(pid==null)this.last.clear();else this.last.delete(pid);}
  observe(packet){
    if(!packet.hasPayload||packet.pid===0x1fff)return true;
    if(packet.adaptation?.discontinuityIndicator){this.last.set(packet.pid,packet.continuityCounter);return true;}
    const previous=this.last.get(packet.pid);this.last.set(packet.pid,packet.continuityCounter);
    if(previous==null)return true;
    const expected=(previous+1)&0xf;
    if(packet.continuityCounter!==expected){const error={pid:packet.pid,expected,actual:packet.continuityCounter,offset:packet.offset};this.errors.push(error);return false;}
    return true;
  }
}

export function parseTsPackets(bytes,{allowTrailing=true}={}){
  const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes),syncOffset=findTsSyncOffset(data);
  if(syncOffset<0)throw new Error('MPEG-TS sync pattern not found');
  const packets=[];
  for(let offset=syncOffset;offset+MPEG_TS_PACKET_SIZE<=data.length;offset+=MPEG_TS_PACKET_SIZE)packets.push(parseTsPacket(data,offset));
  const trailing=data.length-(syncOffset+packets.length*MPEG_TS_PACKET_SIZE);
  if(trailing&&!allowTrailing)throw new Error(`Trailing MPEG-TS bytes: ${trailing}`);
  return {syncOffset,packets,trailing};
}
