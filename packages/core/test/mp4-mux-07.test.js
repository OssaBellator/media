import assert from 'node:assert/strict';
import test from 'node:test';
import { createFragmentedMp4Init, createFragmentedMp4Segment, muxFragmentedMp4, muxMp4 } from '../src/isobmff-mux.js';

function boxes(bytes,start=0,end=bytes.length){const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);const out=[];let offset=start;while(offset+8<=end){let size=view.getUint32(offset,false);const type=String.fromCharCode(...bytes.subarray(offset+4,offset+8));let header=8;if(size===1){size=Number(view.getBigUint64(offset+8,false));header=16;}if(size===0)size=end-offset;if(size<header||offset+size>end)throw new Error(`bad box ${type}`);out.push({type,offset,size,dataOffset:offset+header,end:offset+size});offset+=size;}if(offset!==end)throw new Error('trailing box bytes');return out;}
function child(bytes,parent,type){return boxes(bytes,parent.dataOffset,parent.end).find((b)=>b.type===type);}
function descendants(bytes,parent,path){let list=[parent];for(const type of path){list=list.flatMap((item)=>boxes(bytes,item.dataOffset,item.end).filter((box)=>box.type===type));}return list;}
function fullBody(box){return box.dataOffset+4;}
function samplePlan(container='mp4'){
  const avcC=new Uint8Array([1,0x64,0,0x28,0xff,0xe1,0,0,1,0,0,0]).buffer;
  return {container,tracks:[
    {id:'v',type:'video',codec:'avc1.640028',config:{codedWidth:640,codedHeight:360,description:avcC,framerate:30}},
    {id:'a',type:'audio',codec:'mp4a.40.2',config:{sampleRate:48000,numberOfChannels:2,description:new Uint8Array([0x12,0x10]).buffer}},
  ],samples:[
    {trackId:'v',sequence:0,timestamp:0,dts:0,duration:33333,keyframe:true,payload:new Uint8Array([1,2,3]).buffer,byteLength:3},
    {trackId:'a',sequence:0,timestamp:0,dts:0,duration:21333,keyframe:true,payload:new Uint8Array([4,5]).buffer,byteLength:2},
    {trackId:'a',sequence:1,timestamp:21333,dts:21333,duration:21333,keyframe:true,payload:new Uint8Array([6,7]).buffer,byteLength:2},
    {trackId:'v',sequence:1,timestamp:50000,dts:33333,duration:33333,keyframe:false,payload:new Uint8Array([8,9,10,11]).buffer,byteLength:4},
  ]};
}

test('writes a classic AVC/AAC MP4 with fast-start moov and valid chunk offsets',()=>{
  const bytes=muxMp4(samplePlan());
  const top=boxes(bytes);assert.deepEqual(top.map((b)=>b.type),['ftyp','moov','mdat']);
  assert.ok(top[1].offset<top[2].offset);
  const traks=boxes(bytes,top[1].dataOffset,top[1].end).filter((b)=>b.type==='trak');assert.equal(traks.length,2);
  const stcos=[];const stszs=[];let sawCtts=false,sawStss=false,sawAvcC=false,sawEsds=false;
  for(const trak of traks){const mdia=child(bytes,trak,'mdia'),minf=child(bytes,mdia,'minf'),stbl=child(bytes,minf,'stbl');const entries=boxes(bytes,stbl.dataOffset,stbl.end);const stco=entries.find((b)=>b.type==='stco'||b.type==='co64');const stsz=entries.find((b)=>b.type==='stsz');stcos.push(stco);stszs.push(stsz);sawCtts ||= entries.some((b)=>b.type==='ctts');sawStss ||= entries.some((b)=>b.type==='stss');const stsd=entries.find((b)=>b.type==='stsd');const count=new DataView(bytes.buffer).getUint32(fullBody(stsd),false);assert.equal(count,1);const entry=boxes(bytes,fullBody(stsd)+4,stsd.end)[0];if(entry.type==='avc1'){const nested=boxes(bytes,entry.dataOffset+78,entry.end);sawAvcC=nested.some((b)=>b.type==='avcC');}if(entry.type==='mp4a'){const nested=boxes(bytes,entry.dataOffset+28,entry.end);sawEsds=nested.some((b)=>b.type==='esds');}}
  assert.equal(sawCtts,true);assert.equal(sawStss,true);assert.equal(sawAvcC,true);assert.equal(sawEsds,true);
  const expectedByTrack=[[[1,2,3],[8,9,10,11]],[[4,5],[6,7]]];
  for(let trackIndex=0;trackIndex<2;trackIndex++){const view=new DataView(bytes.buffer);const stco=stcos[trackIndex],stsz=stszs[trackIndex];const coBody=fullBody(stco),count=view.getUint32(coBody,false);const sizeBody=fullBody(stsz),sampleCount=view.getUint32(sizeBody+4,false);assert.equal(count,sampleCount);for(let i=0;i<count;i++){const offset=view.getUint32(coBody+4+i*4,false),size=view.getUint32(sizeBody+8+i*4,false);assert.deepEqual([...bytes.subarray(offset,offset+size)],expectedByTrack[trackIndex][i]);}}
});

test('writes fragment init with mvex/trex and zero-duration sample tables',()=>{
  const bytes=createFragmentedMp4Init(samplePlan());const top=boxes(bytes);assert.deepEqual(top.map((b)=>b.type),['ftyp','moov']);const moov=top[1];const mvex=child(bytes,moov,'mvex');assert.ok(mvex);assert.equal(boxes(bytes,mvex.dataOffset,mvex.end).filter((b)=>b.type==='trex').length,2);
  const traks=boxes(bytes,moov.dataOffset,moov.end).filter((b)=>b.type==='trak');for(const trak of traks){const mdia=child(bytes,trak,'mdia'),minf=child(bytes,mdia,'minf'),stbl=child(bytes,minf,'stbl');const stsz=boxes(bytes,stbl.dataOffset,stbl.end).find((b)=>b.type==='stsz');assert.equal(new DataView(bytes.buffer).getUint32(fullBody(stsz)+4,false),0);}
});

test('writes fMP4 media segment with per-track trun offsets into mdat',()=>{
  const bytes=createFragmentedMp4Segment(samplePlan(),{sequenceNumber:7});const top=boxes(bytes);assert.deepEqual(top.map((b)=>b.type),['moof','mdat']);const moof=top[0],mdat=top[1];const mfhd=child(bytes,moof,'mfhd');assert.equal(new DataView(bytes.buffer).getUint32(fullBody(mfhd),false),7);const trafs=boxes(bytes,moof.dataOffset,moof.end).filter((b)=>b.type==='traf');assert.equal(trafs.length,2);const expectedFirst=[[1,2,3],[4,5]];for(let i=0;i<trafs.length;i++){const trun=child(bytes,trafs[i],'trun');const view=new DataView(bytes.buffer);const body=fullBody(trun);const count=view.getUint32(body,false),dataOffset=view.getInt32(body+4,false);assert.ok(count>0);const firstSize=view.getUint32(body+12,false);const absolute=moof.offset+dataOffset;assert.ok(absolute>=mdat.dataOffset);assert.deepEqual([...bytes.subarray(absolute,absolute+firstSize)],expectedFirst[i]);}
});

test('returns paired init/media fragmented MP4 output',()=>{const out=muxFragmentedMp4(samplePlan());assert.ok(out.initSegment.byteLength>0);assert.ok(out.mediaSegment.byteLength>0);});

test('rejects unsupported MP4 codecs and missing AVC decoder config',()=>{const plan=samplePlan();plan.tracks[0].codec='vp09.00.10.08';assert.throws(()=>muxMp4(plan),/supports AVC/);const missing=samplePlan();delete missing.tracks[0].config.description;assert.throws(()=>muxMp4(missing),/requires avcC/);});
test('emits a leading empty edit when classic track DTS begins after movie time zero',()=>{const plan=samplePlan();for(const sample of plan.samples){sample.dts+=2_000_000;sample.timestamp+=2_000_000;}const bytes=muxMp4(plan);const moov=boxes(bytes).find((b)=>b.type==='moov');const traks=boxes(bytes,moov.dataOffset,moov.end).filter((b)=>b.type==='trak');for(const trak of traks){const edts=child(bytes,trak,'edts'),elst=child(bytes,edts,'elst');assert.ok(elst);const view=new DataView(bytes.buffer);const body=fullBody(elst);assert.equal(view.getUint32(body,false),2);assert.equal(view.getUint32(body+4,false),2000);assert.equal(view.getInt32(body+8,false),-1);}});
test('uses mdhd version one when normalized track duration exceeds 32-bit microseconds',()=>{const plan=samplePlan();plan.tracks=plan.tracks.filter((t)=>t.id==='v');plan.samples=[];for(let i=0;i<4301;i++)plan.samples.push({trackId:'v',sequence:i,timestamp:i*1_000_000,dts:i*1_000_000,duration:1_000_000,keyframe:i%30===0,payload:new Uint8Array([i&255]).buffer,byteLength:1});const bytes=muxMp4(plan);const moov=boxes(bytes).find((b)=>b.type==='moov'),trak=child(bytes,moov,'trak'),mdia=child(bytes,trak,'mdia'),mdhd=child(bytes,mdia,'mdhd');assert.equal(bytes[mdhd.dataOffset],1);});
test('rejects audio sample rates that cannot fit the version-zero mp4a sample entry',()=>{const plan=samplePlan();plan.tracks[1].config.sampleRate=96000;assert.throws(()=>muxMp4(plan),/sampleRate exceeds/);});
