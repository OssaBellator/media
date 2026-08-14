import { createEncodedChunkDescriptor, createTrackDescriptor } from './media-kernel.js';
import { parseIsoBoxes } from './isobmff.js';
function viewOf(input){if(input instanceof DataView)return input;if(input instanceof ArrayBuffer)return new DataView(input);if(ArrayBuffer.isView(input))return new DataView(input.buffer,input.byteOffset,input.byteLength);throw new Error('ISO-BMFF input must be binary');}
function ascii(view,offset,length){let value='';for(let i=0;i<length;i++)value+=String.fromCharCode(view.getUint8(offset+i));return value;}
function u64(view,offset){const value=(BigInt(view.getUint32(offset,false))<<32n)|BigInt(view.getUint32(offset+4,false));if(value>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('64-bit ISO-BMFF value exceeds safe integer range');return Number(value);}
function copyBuffer(view,start,end){return new Uint8Array(view.buffer,view.byteOffset+start,Math.max(0,end-start)).slice().buffer;}
function fullBox(view,box){if(box.dataSize<4)throw new Error(`Invalid full box ${box.type}`);return{version:view.getUint8(box.dataOffset),flags:(view.getUint8(box.dataOffset+1)<<16)|(view.getUint8(box.dataOffset+2)<<8)|view.getUint8(box.dataOffset+3),bodyOffset:box.dataOffset+4};}
function fixed1616(value){return value/65536;}
function languageFromPacked(value){return String.fromCharCode(((value>>10)&31)+0x60,((value>>5)&31)+0x60,(value&31)+0x60);}
export function micros(value,timescale){return Math.max(0,Math.round((Number(value)/Number(timescale))*1_000_000));}
export function isoChildren(input,parent){return parseIsoBoxes(input,{start:parent.dataOffset,end:parent.end});}
export function isoChild(input,parent,type){return isoChildren(input,parent).find((box)=>box.type===type)??null;}
export function parseTkhd(input,box){
  const view=viewOf(input); const {version,flags}=fullBox(view,box); const trackOffset=box.dataOffset+(version===1?20:12); if(trackOffset+4>box.end) throw new Error('Invalid tkhd box');
  const trackId=view.getUint32(trackOffset,false); const width=box.dataSize>=8?fixed1616(view.getUint32(box.end-8,false)):0; const height=box.dataSize>=4?fixed1616(view.getUint32(box.end-4,false)):0;
  return {version,flags,trackId,width,height,enabled:Boolean(flags&1)};
}
export function parseMdhd(input,box){
  const view=viewOf(input); const {version}=fullBox(view,box); const base=box.dataOffset; let timescale,duration,languageOffset;
  if(version===0){ if(box.dataSize<24) throw new Error('Invalid mdhd v0'); timescale=view.getUint32(base+12,false); duration=view.getUint32(base+16,false); languageOffset=base+20; }
  else if(version===1){ if(box.dataSize<36) throw new Error('Invalid mdhd v1'); timescale=view.getUint32(base+20,false); duration=u64(view,base+24); languageOffset=base+32; }
  else throw new Error(`Unsupported mdhd version: ${version}`);
  return {version,timescale,duration,durationSeconds:timescale?duration/timescale:0,language:languageFromPacked(view.getUint16(languageOffset,false))};
}
export function parseHdlr(input,box){ const view=viewOf(input); fullBox(view,box); if(box.dataSize<12) throw new Error('Invalid hdlr box'); return {handlerType:ascii(view,box.dataOffset+8,4)}; }

export function parseStts(input,box){ const view=viewOf(input); const {bodyOffset}=fullBox(view,box); const count=view.getUint32(bodyOffset,false); const entries=[]; let offset=bodyOffset+4; for(let i=0;i<count;i++,offset+=8){ if(offset+8>box.end) throw new Error('Truncated stts'); entries.push({sampleCount:view.getUint32(offset,false),sampleDelta:view.getUint32(offset+4,false)}); } return entries; }
export function parseCtts(input,box){ const view=viewOf(input); const {version,bodyOffset}=fullBox(view,box); const count=view.getUint32(bodyOffset,false); const entries=[]; let offset=bodyOffset+4; for(let i=0;i<count;i++,offset+=8){ if(offset+8>box.end) throw new Error('Truncated ctts'); entries.push({sampleCount:view.getUint32(offset,false),sampleOffset:version===1?view.getInt32(offset+4,false):view.getUint32(offset+4,false)}); } return {version,entries}; }
export function parseStsc(input,box){ const view=viewOf(input); const {bodyOffset}=fullBox(view,box); const count=view.getUint32(bodyOffset,false); const entries=[]; let offset=bodyOffset+4; for(let i=0;i<count;i++,offset+=12){ if(offset+12>box.end) throw new Error('Truncated stsc'); entries.push({firstChunk:view.getUint32(offset,false),samplesPerChunk:view.getUint32(offset+4,false),sampleDescriptionIndex:view.getUint32(offset+8,false)}); } return entries; }
export function parseStsz(input,box){ const view=viewOf(input); const {bodyOffset}=fullBox(view,box); const sampleSize=view.getUint32(bodyOffset,false),sampleCount=view.getUint32(bodyOffset+4,false); if(sampleSize) return {sampleSize,sampleCount,sizes:Array(sampleCount).fill(sampleSize)}; const sizes=[]; let offset=bodyOffset+8; for(let i=0;i<sampleCount;i++,offset+=4){ if(offset+4>box.end) throw new Error('Truncated stsz'); sizes.push(view.getUint32(offset,false)); } return {sampleSize,sampleCount,sizes}; }
export function parseStz2(input,box){ const view=viewOf(input); const {bodyOffset}=fullBox(view,box); if(bodyOffset+8>box.end)throw new Error('Invalid stz2'); const fieldSize=view.getUint8(bodyOffset+3),sampleCount=view.getUint32(bodyOffset+4,false); if(![4,8,16].includes(fieldSize))throw new Error(`Unsupported stz2 field size: ${fieldSize}`); const sizes=[]; let offset=bodyOffset+8; if(fieldSize===4){for(let i=0;i<sampleCount;i++){if(offset>=box.end)throw new Error('Truncated stz2');const byte=view.getUint8(offset);sizes.push(i%2===0?byte>>4:byte&15);if(i%2===1)offset++;}if(sampleCount%2)offset++;}else{const width=fieldSize/8;for(let i=0;i<sampleCount;i++,offset+=width){if(offset+width>box.end)throw new Error('Truncated stz2');sizes.push(width===1?view.getUint8(offset):view.getUint16(offset,false));}} return {sampleSize:0,sampleCount,sizes,fieldSize}; }
export function parseChunkOffsets(input,box){ const view=viewOf(input); const {bodyOffset}=fullBox(view,box); const count=view.getUint32(bodyOffset,false); const offsets=[]; let offset=bodyOffset+4; const wide=box.type==='co64'; for(let i=0;i<count;i++,offset+=wide?8:4){ if(offset+(wide?8:4)>box.end) throw new Error(`Truncated ${box.type}`); offsets.push(wide?u64(view,offset):view.getUint32(offset,false)); } return offsets; }
export function parseStss(input,box){ const view=viewOf(input); const {bodyOffset}=fullBox(view,box); const count=view.getUint32(bodyOffset,false); const samples=[]; let offset=bodyOffset+4; for(let i=0;i<count;i++,offset+=4){ if(offset+4>box.end) throw new Error('Truncated stss'); samples.push(view.getUint32(offset,false)); } return samples; }

function nestedSampleEntryBoxes(view, entry, kind){ const start=entry.dataOffset+(kind==='video'?78:kind==='audio'?28:8); if(start+8>entry.end) return []; try{return parseIsoBoxes(view,{start,end:entry.end});}catch{return [];} }
function avcCodec(description,type){ if(!description||description.byteLength<4) return type; const bytes=new Uint8Array(description); return `${type}.${[bytes[1],bytes[2],bytes[3]].map((v)=>v.toString(16).padStart(2,'0')).join('').toUpperCase()}`; }
function readDescriptorLength(view,offset,end){let size=0,count=0;while(offset<end&&count<4){const value=view.getUint8(offset++);size=(size<<7)|(value&0x7f);count++;if(!(value&0x80))return{size,bytes:count};}throw new Error('Invalid MPEG-4 descriptor length');}
function findDescriptorPayload(view,start,end,targetTag){let offset=start;while(offset<end){const tag=view.getUint8(offset++);const length=readDescriptorLength(view,offset,end);offset+=length.bytes;const dataOffset=offset,dataEnd=Math.min(end,dataOffset+length.size);if(dataEnd<dataOffset+length.size)throw new Error('Truncated MPEG-4 descriptor');if(tag===targetTag)return{dataOffset,end:dataEnd};let childStart=null;if(tag===0x03&&dataEnd-dataOffset>=3){const flags=view.getUint8(dataOffset+2);childStart=dataOffset+3;if(flags&0x80)childStart+=2;if(flags&0x40){const urlLength=view.getUint8(childStart);childStart+=1+urlLength;}if(flags&0x20)childStart+=2;}else if(tag===0x04&&dataEnd-dataOffset>=13)childStart=dataOffset+13;if(childStart!=null&&childStart<dataEnd){const nested=findDescriptorPayload(view,childStart,dataEnd,targetTag);if(nested)return nested;}offset=dataEnd;}return null;}
function parseEsdsConfig(view,box){const start=box.dataOffset+4;if(start>=box.end)return null;const descriptor=findDescriptorPayload(view,start,box.end,0x05);return descriptor?copyBuffer(view,descriptor.dataOffset,descriptor.end):null;}
function aacCodec(description){if(!description||!description.byteLength)return'mp4a.40.2';const bytes=new Uint8Array(description);let type=bytes[0]>>3;if(type===31&&bytes.length>1)type=32+(((bytes[0]&7)<<3)|(bytes[1]>>5));return`mp4a.40.${type||2}`;}
function codecInfoForEntry(view,entry,kind){
  const nested=nestedSampleEntryBoxes(view,entry,kind); const byType=(type)=>nested.find((box)=>box.type===type); let description=null; let codec=entry.type;
  if(['avc1','avc3'].includes(entry.type)){const config=byType('avcC'); if(config){description=copyBuffer(view,config.dataOffset,config.end); codec=avcCodec(description,entry.type);} }
  else if(['hvc1','hev1'].includes(entry.type)){const config=byType('hvcC'); if(config)description=copyBuffer(view,config.dataOffset,config.end);}
  else if(entry.type==='av01'){const config=byType('av1C'); if(config)description=copyBuffer(view,config.dataOffset,config.end);}
  else if(['vp08','vp09'].includes(entry.type)){const config=byType('vpcC'); if(config)description=copyBuffer(view,config.dataOffset,config.end); codec=entry.type==='vp09'?'vp09':entry.type;}
  else if(entry.type==='mp4a'){const config=byType('esds'); if(config)description=parseEsdsConfig(view,config); codec=aacCodec(description);}
  else if(entry.type==='Opus'){const config=byType('dOps'); if(config)description=copyBuffer(view,config.dataOffset,config.end); codec='opus';}
  return {codec,description,nested:nested.map(({type,offset,size})=>({type,offset,size}))};
}
export function parseStsd(input,box,kind){
  const view=viewOf(input); const {bodyOffset}=fullBox(view,box); const entryCount=view.getUint32(bodyOffset,false); const entries=parseIsoBoxes(view,{start:bodyOffset+4,end:box.end}).slice(0,entryCount);
  return entries.map((entry,index)=>{
    const info={index:index+1,type:entry.type}; const codec=codecInfoForEntry(view,entry,kind); Object.assign(info,codec);
    if(kind==='video'){ if(entry.dataSize<28) throw new Error(`Invalid visual sample entry ${entry.type}`); info.width=view.getUint16(entry.dataOffset+24,false); info.height=view.getUint16(entry.dataOffset+26,false); }
    if(kind==='audio'){ if(entry.dataSize<28) throw new Error(`Invalid audio sample entry ${entry.type}`); info.channels=view.getUint16(entry.dataOffset+16,false); info.sampleSize=view.getUint16(entry.dataOffset+18,false); info.sampleRate=fixed1616(view.getUint32(entry.dataOffset+24,false)); }
    return info;
  });
}

function expandRunTable(entries,countKey,valueKey,total,defaultValue=0){ const values=new Array(total); let index=0; for(const entry of entries??[]){ for(let i=0;i<entry[countKey]&&index<total;i++) values[index++]=entry[valueKey]; } while(index<total) values[index++]=defaultValue; return values; }
function stscForChunk(entries,chunkNumber){ let current=entries[0]; for(const entry of entries){ if(entry.firstChunk>chunkNumber)break; current=entry; } return current; }
export function buildIsoSampleIndex({trackId,timescale,stts,ctts,stsc,stsz,chunkOffsets,stss}){
  if(!stsc?.length) throw new Error(`Track ${trackId} has no stsc entries`); if(stsz.sizes.length!==stsz.sampleCount) throw new Error('stsz sample count mismatch');
  const durations=expandRunTable(stts,'sampleCount','sampleDelta',stsz.sampleCount,0); const composition=ctts?expandRunTable(ctts.entries,'sampleCount','sampleOffset',stsz.sampleCount,0):Array(stsz.sampleCount).fill(0); const sync=stss?new Set(stss):null;
  const samples=[]; let sampleIndex=0; let dts=0;
  for(let chunkIndex=0;chunkIndex<chunkOffsets.length && sampleIndex<stsz.sampleCount;chunkIndex++){
    const map=stscForChunk(stsc,chunkIndex+1); if(!map) throw new Error(`Missing stsc mapping for chunk ${chunkIndex+1}`); let within=0;
    for(let slot=0;slot<map.samplesPerChunk && sampleIndex<stsz.sampleCount;slot++){
      const size=stsz.sizes[sampleIndex],duration=durations[sampleIndex]??0,pts=dts+(composition[sampleIndex]??0); const sampleNumber=sampleIndex+1;
      const descriptor=createEncodedChunkDescriptor({trackId,type:!sync||sync.has(sampleNumber)?'key':'delta',timestamp:micros(Math.max(0,pts),timescale),duration:micros(duration,timescale),byteLength:size,offset:chunkOffsets[chunkIndex]+within,sequence:sampleIndex});
      samples.push({...descriptor,decodeTimestamp:micros(dts,timescale),presentationTimestamp:micros(Math.max(0,pts),timescale),sampleNumber,descriptionIndex:map.sampleDescriptionIndex}); within+=size; dts+=duration; sampleIndex++;
    }
  }
  if(sampleIndex!==stsz.sampleCount) throw new Error(`Sample table maps ${sampleIndex} of ${stsz.sampleCount} samples`);
  return samples;
}

export function parseIsoTrack(view,trak){
  const children=isoChildren(view,trak); const tkhdBox=children.find((box)=>box.type==='tkhd'); const mdia=children.find((box)=>box.type==='mdia'); if(!tkhdBox||!mdia) return null;
  const tkhd=parseTkhd(view,tkhdBox); const mdiaChildren=isoChildren(view,mdia); const mdhdBox=mdiaChildren.find((box)=>box.type==='mdhd'); const hdlrBox=mdiaChildren.find((box)=>box.type==='hdlr'); const minf=mdiaChildren.find((box)=>box.type==='minf'); if(!mdhdBox||!hdlrBox||!minf) return null;
  const mdhd=parseMdhd(view,mdhdBox),handler=parseHdlr(view,hdlrBox); const kind=handler.handlerType==='vide'?'video':handler.handlerType==='soun'?'audio':null; if(!kind) return null;
  const stbl=isoChild(view,minf,'stbl'); if(!stbl) throw new Error(`Track ${tkhd.trackId} has no stbl`); const table=Object.fromEntries(isoChildren(view,stbl).map((box)=>[box.type,box]));
  if(!table.stsd)throw new Error(`Track ${tkhd.trackId} missing stsd`); const descriptions=parseStsd(view,table.stsd,kind); if(!descriptions.length) throw new Error(`Track ${tkhd.trackId} has no sample descriptions`); const primary=descriptions[0]; const id=`${kind}:${tkhd.trackId}`;
  const track=createTrackDescriptor({id,type:kind,codec:primary.codec,timescale:mdhd.timescale,duration:mdhd.durationSeconds,width:kind==='video'?(primary.width||tkhd.width):undefined,height:kind==='video'?(primary.height||tkhd.height):undefined,sampleRate:kind==='audio'?primary.sampleRate:undefined,channels:kind==='audio'?primary.channels:undefined,description:primary.description,language:mdhd.language});
  const classicReady=Boolean(table.stts&&table.stsc&&(table.stsz||table.stz2)&&(table.stco||table.co64));
  const chunks=classicReady?buildIsoSampleIndex({trackId:id,timescale:mdhd.timescale,stts:parseStts(view,table.stts),ctts:table.ctts?parseCtts(view,table.ctts):null,stsc:parseStsc(view,table.stsc),stsz:table.stsz?parseStsz(view,table.stsz):parseStz2(view,table.stz2),chunkOffsets:parseChunkOffsets(view,table.stco??table.co64),stss:table.stss?parseStss(view,table.stss):null}):[];
  return {track,chunks,tkhd,mdhd,descriptions,classicReady};
}
