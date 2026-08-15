function concat(chunks,total){const out=new Uint8Array(total);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length;}return out;}

export class PsiSectionAssembler{
  constructor(){this.buffers=new Map();}
  reset(pid=null){if(pid==null)this.buffers.clear();else this.buffers.delete(pid);}
  push(packet){
    if(!packet.hasPayload||!packet.payload.length)return[];
    let payload=packet.payload;
    if(packet.payloadUnitStart){const pointer=payload[0]??0;payload=payload.subarray(Math.min(payload.length,1+pointer));this.buffers.delete(packet.pid);}
    const previous=this.buffers.get(packet.pid)??new Uint8Array();
    const merged=new Uint8Array(previous.length+payload.length);merged.set(previous);merged.set(payload,previous.length);
    const sections=[];let offset=0;
    while(offset+3<=merged.length){
      if(merged[offset]===0xff){offset=merged.length;break;}
      const sectionLength=((merged[offset+1]&0x0f)<<8)|merged[offset+2],total=3+sectionLength;
      if(offset+total>merged.length)break;
      sections.push(merged.slice(offset,offset+total));offset+=total;
    }
    this.buffers.set(packet.pid,merged.slice(offset));return sections;
  }
}

export function parsePatSection(section){
  if(section?.[0]!==0x00)throw new Error('Not a PAT section');
  const sectionLength=((section[1]&0xf)<<8)|section[2],end=Math.min(section.length,3+sectionLength-4),programs=[];
  const transportStreamId=(section[3]<<8)|section[4],version=(section[5]>>1)&0x1f,currentNext=Boolean(section[5]&1);
  for(let offset=8;offset+4<=end;offset+=4){const programNumber=(section[offset]<<8)|section[offset+1],pid=((section[offset+2]&0x1f)<<8)|section[offset+3];if(programNumber)programs.push({programNumber,pmtPid:pid});}
  return {table:'pat',transportStreamId,version,currentNext,programs};
}

export function streamTypeInfo(streamType){
  switch(streamType){
    case 0x1b:return{kind:'video',codec:'avc1',name:'H.264/AVC'};
    case 0x24:return{kind:'video',codec:'hvc1',name:'H.265/HEVC'};
    case 0x0f:return{kind:'audio',codec:'mp4a.40.2',name:'AAC/ADTS'};
    case 0x11:return{kind:'audio',codec:'mp4a.40.2',name:'AAC/LATM'};
    case 0x03:case 0x04:return{kind:'audio',codec:'mp3',name:'MPEG audio'};
    case 0x81:return{kind:'audio',codec:'ac-3',name:'AC-3'};
    default:return{kind:'data',codec:`ts-${streamType.toString(16).padStart(2,'0')}`,name:'private/data'};
  }
}

export function parsePmtSection(section){
  if(section?.[0]!==0x02)throw new Error('Not a PMT section');
  const sectionLength=((section[1]&0xf)<<8)|section[2],end=Math.min(section.length,3+sectionLength-4),programNumber=(section[3]<<8)|section[4],version=(section[5]>>1)&0x1f,pcrPid=((section[8]&0x1f)<<8)|section[9],programInfoLength=((section[10]&0xf)<<8)|section[11],streams=[];
  let offset=12+programInfoLength;
  while(offset+5<=end){const streamType=section[offset],pid=((section[offset+1]&0x1f)<<8)|section[offset+2],esInfoLength=((section[offset+3]&0xf)<<8)|section[offset+4],descriptors=section.slice(offset+5,Math.min(end,offset+5+esInfoLength));streams.push({streamType,pid,descriptors,...streamTypeInfo(streamType)});offset+=5+esInfoLength;}
  return {table:'pmt',programNumber,version,pcrPid,streams};
}
