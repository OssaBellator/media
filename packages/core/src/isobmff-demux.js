import { createDemuxPlan } from './media-kernel.js';
import { parseFtyp, parseIsoBoxes, parseMvhd } from './isobmff.js';
import { isoChild, isoChildren, parseIsoTrack } from './isobmff-tables.js';
import { buildIsoFragmentIndex } from './isobmff-fragments.js';
import { applyIsoEditList, parseElst } from './isobmff-edits.js';
function viewOf(input){if(input instanceof DataView)return input;if(input instanceof ArrayBuffer)return new DataView(input);if(ArrayBuffer.isView(input))return new DataView(input.buffer,input.byteOffset,input.byteLength);throw new Error('ISO-BMFF input must be binary');}
function parseTrackEdits(view,trak){const edts=isoChild(view,trak,'edts');if(!edts)return null;const elst=isoChild(view,edts,'elst');return elst?parseElst(view,elst):null;}
export function demuxIsoBmff(input,{container='mp4',applyEditLists=true}={}){
  const view=viewOf(input);const top=parseIsoBoxes(view);const ftyp=top.find((box)=>box.type==='ftyp');const moov=top.find((box)=>box.type==='moov');if(!moov)throw new Error('ISO-BMFF moov box not found');
  const movieBox=isoChild(view,moov,'mvhd');const movie=movieBox?parseMvhd(view,movieBox):null;const trakBoxes=isoChildren(view,moov).filter((box)=>box.type==='trak');
  const parsedTracks=trakBoxes.map((trak)=>{const parsed=parseIsoTrack(view,trak);return parsed?{...parsed,editList:parseTrackEdits(view,trak)}:null;}).filter(Boolean);if(!parsedTracks.length)throw new Error('No supported audio/video tracks found in moov');
  const tracks=parsedTracks.map((item)=>item.track);const classicChunks=parsedTracks.flatMap((item)=>item.chunks);const fragmented=top.some((box)=>box.type==='moof');const fragmentChunks=fragmented?buildIsoFragmentIndex(view,{moov,parsedTracks,topLevel:top}):[];let chunks=[...classicChunks,...fragmentChunks];
  const editLists={};
  if(applyEditLists&&movie?.timescale){for(const item of parsedTracks){if(!item.editList?.entries?.length)continue;const own=chunks.filter((chunk)=>chunk.trackId===item.track.id);try{const adjusted=applyIsoEditList(own,item.editList,{movieTimescale:movie.timescale,mediaTimescale:item.mdhd.timescale});chunks=[...chunks.filter((chunk)=>chunk.trackId!==item.track.id),...adjusted];editLists[item.track.id]={applied:true,entries:item.editList.entries};}catch(error){editLists[item.track.id]={applied:false,entries:item.editList.entries,reason:error.message};}}chunks.sort((a,b)=>Number(a.decodeTimestamp??a.timestamp)-Number(b.decodeTimestamp??b.timestamp)||String(a.trackId).localeCompare(String(b.trackId))||Number(a.sequence??0)-Number(b.sequence??0));}
  const seekPoints=[...new Set(chunks.filter((chunk)=>chunk.type==='key'&&tracks.find((track)=>track.id===chunk.trackId)?.type==='video').map((chunk)=>(chunk.presentationTimestamp??chunk.timestamp)/1_000_000))].sort((a,b)=>a-b);
  const duration=movie?.durationSeconds||Math.max(...tracks.map((track)=>track.duration),...chunks.map((chunk)=>(Number(chunk.presentationTimestamp??chunk.timestamp)+Number(chunk.duration??0))/1_000_000),0);
  const plan=createDemuxPlan({container,duration,tracks,seekPoints,metadata:{brands:ftyp?parseFtyp(view,ftyp):null,topLevelBoxes:top.map(({type,offset,size})=>({type,offset,size})),sampleCount:chunks.length,fragmented,editLists}});
  return{...plan,chunks,trackDetails:parsedTracks.map(({track,tkhd,mdhd,descriptions,classicReady,editList})=>({id:track.id,tkhd,mdhd,descriptions,classicReady,editList}))};
}
export function readIsoSample(input,sample,{copy=true}={}){const view=viewOf(input);if(sample?.offset==null||sample?.byteLength==null)throw new Error('Sample requires offset and byteLength');const start=Number(sample.offset),end=start+Number(sample.byteLength);if(start<0||end>view.byteLength)throw new Error('Sample byte range exceeds source');const bytes=new Uint8Array(view.buffer,view.byteOffset+start,Number(sample.byteLength));return copy?bytes.slice():bytes;}
