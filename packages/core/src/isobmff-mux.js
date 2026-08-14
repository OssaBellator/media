function bytesOf(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new Error('MP4 payload must be binary');
}
function concat(parts) {
  const arrays = parts.filter(Boolean).map(bytesOf);
  const length = arrays.reduce((sum, part) => sum + part.length, 0);
  if (length > 0xffffffff) throw new Error('In-memory MP4 output exceeds 4 GiB');
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of arrays) { output.set(part, offset); offset += part.length; }
  return output;
}
function ascii(value) { return new TextEncoder().encode(String(value)); }
function u8(value) { return new Uint8Array([Number(value) & 0xff]); }
function u16(value) { const out = new Uint8Array(2); new DataView(out.buffer).setUint16(0, Number(value) >>> 0, false); return out; }
function i16(value) { const out = new Uint8Array(2); new DataView(out.buffer).setInt16(0, Number(value), false); return out; }
function u24(value) { const n = Number(value) >>> 0; return new Uint8Array([(n >>> 16) & 255, (n >>> 8) & 255, n & 255]); }
function u32(value) { const out = new Uint8Array(4); new DataView(out.buffer).setUint32(0, Number(value) >>> 0, false); return out; }
function i32(value) { const out = new Uint8Array(4); new DataView(out.buffer).setInt32(0, Number(value) | 0, false); return out; }
function u64(value) { let n = BigInt(Math.max(0, Math.round(Number(value) || 0))); const out = new Uint8Array(8); for (let i = 7; i >= 0; i--) { out[i] = Number(n & 255n); n >>= 8n; } return out; }
function fixed1616(value) { return u32(Math.round(Number(value) * 65536)); }
function box(type, ...payload) { const body = concat(payload); return concat([u32(body.length + 8), ascii(type), body]); }
function fullBox(type, version, flags, ...payload) { return box(type, u8(version), u24(flags), ...payload); }
function languageCode(code = 'und') { const text = String(code).padEnd(3, 'd').slice(0, 3).toLowerCase(); return ((text.charCodeAt(0) - 0x60) << 10) | ((text.charCodeAt(1) - 0x60) << 5) | (text.charCodeAt(2) - 0x60); }
const IDENTITY_MATRIX = concat([u32(0x00010000),u32(0),u32(0),u32(0),u32(0x00010000),u32(0),u32(0),u32(0),u32(0x40000000)]);
function descriptorLength(length) { let value = Number(length); const bytes = [value & 0x7f]; while ((value >>= 7)) bytes.unshift((value & 0x7f) | 0x80); return new Uint8Array(bytes); }
function descriptor(tag, ...payload) { const body = concat(payload); return concat([u8(tag), descriptorLength(body.length), body]); }
function samplePayload(sample) { const value = sample.payload ?? sample.bytes; if (value == null) throw new Error(`MP4 sample ${sample.trackId}:${sample.sequence ?? 0} has no payload`); const bytes = bytesOf(value); if (Number(sample.byteLength ?? 0) > 0 && Number(sample.byteLength) !== bytes.byteLength) throw new Error(`MP4 sample byteLength mismatch for ${sample.trackId}:${sample.sequence ?? 0}`); return bytes; }
function audioSpecificConfig(track) {
  const description = track.config?.description;
  if (description) return bytesOf(description);
  if (!String(track.codec).startsWith('mp4a.40.')) throw new Error(`AAC track ${track.id} requires AudioSpecificConfig`);
  const objectType = Number(String(track.codec).split('.').at(-1)) || 2;
  const sampleRate = Number(track.config?.sampleRate ?? track.config?.sample_rate);
  const channels = Number(track.config?.channels ?? track.config?.numberOfChannels);
  const rates = [96000,88200,64000,48000,44100,32000,24000,22050,16000,12000,11025,8000,7350];
  const frequencyIndex = rates.indexOf(sampleRate);
  if (frequencyIndex < 0 || channels < 1 || channels > 7) throw new Error(`AAC track ${track.id} requires supported sampleRate/channels or decoder description`);
  return new Uint8Array([(objectType << 3) | (frequencyIndex >> 1), ((frequencyIndex & 1) << 7) | (channels << 3)]);
}
function esds(track) {
  const config = audioSpecificConfig(track);
  const decoderSpecific = descriptor(0x05, config);
  const decoderConfig = descriptor(0x04, u8(0x40), u8(0x15), u24(0), u32(0), u32(0), decoderSpecific);
  const slConfig = descriptor(0x06, u8(2));
  return fullBox('esds', 0, 0, descriptor(0x03, u16(1), u8(0), decoderConfig, slConfig));
}
function videoSampleEntry(track) {
  const codec = String(track.codec).split('.')[0];
  if (!['avc1','avc3'].includes(codec)) throw new Error(`MP4 writer currently supports AVC video, received ${track.codec}`);
  const description = track.config?.description;
  if (!description) throw new Error(`AVC track ${track.id} requires avcC decoder description`);
  const width = Number(track.config?.width ?? track.config?.codedWidth);
  const height = Number(track.config?.height ?? track.config?.codedHeight);
  if (!width || !height) throw new Error(`AVC track ${track.id} requires width and height`);
  const compressor = new Uint8Array(32); const name = ascii('Media AVC'); compressor[0] = Math.min(31, name.length); compressor.set(name.subarray(0, 31), 1);
  return box(codec,
    new Uint8Array(6), u16(1), new Uint8Array(16), u16(width), u16(height),
    fixed1616(72), fixed1616(72), u32(0), u16(1), compressor, u16(0x18), u16(0xffff),
    box('avcC', bytesOf(description))
  );
}
function audioSampleEntry(track) {
  if (!String(track.codec).startsWith('mp4a')) throw new Error(`MP4 writer currently supports AAC audio, received ${track.codec}`);
  const sampleRate = Number(track.config?.sampleRate ?? track.config?.sample_rate);
  const channels = Number(track.config?.channels ?? track.config?.numberOfChannels);
  if (!sampleRate || !channels) throw new Error(`AAC track ${track.id} requires sampleRate and channels`); if(sampleRate>65535)throw new Error(`AAC track ${track.id} sampleRate exceeds version-0 mp4a capacity`);
  return box('mp4a', new Uint8Array(6), u16(1), new Uint8Array(8), u16(channels), u16(16), u16(0), u16(0), fixed1616(sampleRate), esds(track));
}
function sampleEntry(track) { return track.type === 'video' ? videoSampleEntry(track) : track.type === 'audio' ? audioSampleEntry(track) : (() => { throw new Error(`Unsupported MP4 track type: ${track.type}`); })(); }
function stsd(track) { return fullBox('stsd', 0, 0, u32(1), sampleEntry(track)); }
function runEntries(values) { const entries=[]; for (const value of values) { const previous=entries.at(-1); if (previous && previous.value===value) previous.count++; else entries.push({count:1,value}); } return entries; }
function stts(samples) { const runs = runEntries(samples.map((sample)=>sample.duration)); return fullBox('stts',0,0,u32(runs.length),...runs.flatMap((run)=>[u32(run.count),u32(run.value)])); }
function ctts(samples) { const offsets=samples.map((sample)=>sample.pts-sample.dts); if (!offsets.some(Boolean)) return null; const signed=offsets.some((value)=>value<0); const runs=runEntries(offsets); return fullBox('ctts',signed?1:0,0,u32(runs.length),...runs.flatMap((run)=>[u32(run.count),signed?i32(run.value):u32(run.value)])); }
function stsc(samples) { return fullBox('stsc',0,0,u32(samples.length?1:0),...(samples.length?[u32(1),u32(1),u32(1)]:[])); }
function stsz(samples) { return fullBox('stsz',0,0,u32(0),u32(samples.length),...samples.map((sample)=>u32(sample.payload.byteLength))); }
function stco(samples) { const wide=samples.some((sample)=>sample.offset>0xffffffff); return fullBox(wide?'co64':'stco',0,0,u32(samples.length),...samples.map((sample)=>wide?u64(sample.offset):u32(sample.offset))); }
function stss(samples) { const sync=[]; samples.forEach((sample,index)=>{if(sample.keyframe)sync.push(index+1);}); return sync.length ? fullBox('stss',0,0,u32(sync.length),...sync.map(u32)) : null; }
function emptyStbl(track) { return box('stbl',stsd(track),fullBox('stts',0,0,u32(0)),fullBox('stsc',0,0,u32(0)),fullBox('stsz',0,0,u32(0),u32(0)),fullBox('stco',0,0,u32(0))); }
function stbl(track,samples) { return box('stbl',stsd(track),stts(samples),ctts(samples),stsc(samples),stsz(samples),stco(samples),track.type==='video'?stss(samples):null); }
function dref() { return box('dinf', fullBox('dref',0,0,u32(1),fullBox('url ',0,1))); }
function mediaHeader(track) { return track.type==='video' ? fullBox('vmhd',0,1,u16(0),u16(0),u16(0),u16(0)) : fullBox('smhd',0,0,i16(0),u16(0)); }
function mdhd(track,duration) { const value=Math.max(0,Math.round(duration)); return value>0xffffffff ? fullBox('mdhd',1,0,u64(0),u64(0),u32(1_000_000),u64(value),u16(languageCode(track.language ?? 'und')),u16(0)) : fullBox('mdhd',0,0,u32(0),u32(0),u32(1_000_000),u32(value),u16(languageCode(track.language ?? 'und')),u16(0)); }
function hdlr(track) { const type=track.type==='video'?'vide':'soun'; const name=ascii(track.type==='video'?'Media Video\0':'Media Audio\0'); return fullBox('hdlr',0,0,u32(0),ascii(type),new Uint8Array(12),name); }
function minf(track,samples,{fragmented=false}={}) { return box('minf',mediaHeader(track),dref(),fragmented?emptyStbl(track):stbl(track,samples)); }
function mdia(track,samples,{fragmented=false}={}) { const duration=fragmented?0:samples.reduce((max,s)=>Math.max(max,(s.dts-track._baseDts)+s.duration),0); return box('mdia',mdhd(track,duration),hdlr(track),minf(track,samples,{fragmented})); }
function tkhd(track,trackId,durationMovie,{fragmented=false}={}) {
  const width=track.type==='video'?Number(track.config?.width??track.config?.codedWidth??0):0;
  const height=track.type==='video'?Number(track.config?.height??track.config?.codedHeight??0):0;
  return fullBox('tkhd',0,7,u32(0),u32(0),u32(trackId),u32(0),u32(fragmented?0:durationMovie),new Uint8Array(8),u16(0),u16(0),u16(track.type==='audio'?0x0100:0),u16(0),IDENTITY_MATRIX,fixed1616(width),fixed1616(height));
}
function editBox(track,samples,movieTimescale){if(!samples.length||!track._baseDts)return null;const emptyDuration=Math.max(0,Math.round(track._baseDts*movieTimescale/1_000_000));const mediaDurationMicros=samples.reduce((max,s)=>Math.max(max,(s.pts-track._baseDts)+s.duration),0);const mediaDuration=Math.max(0,Math.round(mediaDurationMicros*movieTimescale/1_000_000));return box('edts',fullBox('elst',0,0,u32(2),u32(emptyDuration),i32(-1),i16(1),i16(0),u32(mediaDuration),i32(0),i16(1),i16(0)));}
function trak(track,trackId,samples,movieTimescale,{fragmented=false}={}) { const durationMicros=fragmented?0:samples.reduce((max,s)=>Math.max(max,s.pts+s.duration),0); const durationMovie=Math.round(durationMicros*movieTimescale/1_000_000); return box('trak',tkhd(track,trackId,durationMovie,{fragmented}),fragmented?null:editBox(track,samples,movieTimescale),mdia(track,samples,{fragmented})); }
function mvhd(durationMicros,nextTrackId,movieTimescale=1000) { const duration=Math.round(durationMicros*movieTimescale/1_000_000); return fullBox('mvhd',0,0,u32(0),u32(0),u32(movieTimescale),u32(Math.min(0xffffffff,duration)),fixed1616(1),u16(0x0100),u16(0),new Uint8Array(8),IDENTITY_MATRIX,new Uint8Array(24),u32(nextTrackId)); }
function trex(trackId) { return fullBox('trex',0,0,u32(trackId),u32(1),u32(0),u32(0),u32(0)); }
function ftyp({fragmented=false,mov=false}={}) { return box('ftyp',ascii(fragmented?'iso6':mov?'qt  ':'isom'),u32(fragmented?1:512),ascii(fragmented?'iso6':'isom'),ascii('isom'),ascii('mp41'),fragmented?ascii('dash'):null); }
function normalizePlan(plan) {
  if (!plan || !['mp4','mov'].includes(plan.container)) throw new Error('MP4 writer requires an mp4/mov mux plan');
  if (!Array.isArray(plan.tracks) || !plan.tracks.length) throw new Error('MP4 writer requires tracks');
  const tracks=plan.tracks.map((track,index)=>({...track,_numericId:index+1,config:{...(track.config??{})}}));
  const map=new Map(tracks.map((track)=>[track.id,track]));
  const samples=(plan.samples??[]).map((sample,index)=>{const track=map.get(sample.trackId);if(!track)throw new Error(`MP4 sample references unknown track ${sample.trackId}`);return{...sample,_globalIndex:index,payload:samplePayload(sample),dts:Math.max(0,Math.round(Number(sample.dts??sample.timestamp??0))),pts:Math.max(0,Math.round(Number(sample.timestamp??sample.dts??0))),duration:Math.max(0,Math.round(Number(sample.duration??0))),keyframe:Boolean(sample.keyframe??sample.type==='key')};});
  for (const track of tracks) {
    const list=samples.filter((sample)=>sample.trackId===track.id).sort((a,b)=>a.dts-b.dts||Number(a.sequence??0)-Number(b.sequence??0));
    for(let i=0;i<list.length;i++) if(!list[i].duration){const next=list[i+1];const previous=list[i-1];const frameRate=Number(track.config?.framerate??track.config?.frameRate??0);const audioRate=Number(track.config?.sampleRate??track.config?.sample_rate??0);list[i].duration=next?Math.max(1,next.dts-list[i].dts):previous?.duration||Math.max(1,Math.round(track.type==='video'&&frameRate?1_000_000/frameRate:track.type==='audio'&&audioRate?1024_000_000/audioRate:33_333));}
    track._samples=list;track._baseDts=list.length?Math.min(...list.map((sample)=>sample.dts)):0;
  }
  return {tracks,samples};
}
function buildMoov(tracks,{fragmented=false,movieTimescale=1000}={}) { const duration=fragmented?0:Math.max(0,...tracks.flatMap((track)=>track._samples).map((sample)=>sample.pts+sample.duration)); return box('moov',mvhd(duration,tracks.length+1,movieTimescale),...tracks.map((track)=>trak(track,track._numericId,track._samples,movieTimescale,{fragmented})),fragmented?box('mvex',...tracks.map((track)=>trex(track._numericId))):null); }
export function muxMp4(plan,{movieTimescale=1000}={}) {
  const normalized=normalizePlan(plan); const header=ftyp({mov:plan.container==='mov'}); let moov=buildMoov(normalized.tracks,{movieTimescale});
  for(let pass=0;pass<3;pass++) { let offset=header.length+moov.length+8; for(const sample of normalized.samples){sample.offset=offset;offset+=sample.payload.length;} const next=buildMoov(normalized.tracks,{movieTimescale}); if(next.length===moov.length){moov=next;break;} moov=next; }
  const mdat=box('mdat',...normalized.samples.map((sample)=>sample.payload)); return concat([header,moov,mdat]);
}
export function createFragmentedMp4Init(plan,{movieTimescale=1000}={}) { const normalized=normalizePlan(plan); return concat([ftyp({fragmented:true}),buildMoov(normalized.tracks,{fragmented:true,movieTimescale})]); }
function mfhd(sequenceNumber) { return fullBox('mfhd',0,0,u32(sequenceNumber)); }
function tfhd(trackId) { return fullBox('tfhd',0,0x020000,u32(trackId)); }
function tfdt(baseTime) { return fullBox('tfdt',1,0,u64(baseTime)); }
function sampleFlags(sample) { return sample.keyframe ? 0x02000000 : 0x01010000; }
function trun(samples,dataOffset) { const signed=samples.some((sample)=>sample.pts-sample.dts<0); const flags=0x000f01; return fullBox('trun',signed?1:0,flags,u32(samples.length),i32(dataOffset),...samples.flatMap((sample)=>[u32(sample.duration),u32(sample.payload.length),u32(sampleFlags(sample)),signed?i32(sample.pts-sample.dts):u32(sample.pts-sample.dts)])); }
function traf(track,dataOffset) { const base=Math.min(...track._samples.map((sample)=>sample.dts)); return box('traf',tfhd(track._numericId),tfdt(Math.max(0,base)),trun(track._samples,dataOffset)); }
function buildMoof(tracks,sequenceNumber,dataOffsets) { return box('moof',mfhd(sequenceNumber),...tracks.filter((track)=>track._samples.length).map((track)=>traf(track,dataOffsets.get(track.id)??0))); }
export function createFragmentedMp4Segment(plan,{sequenceNumber=1}={}) {
  const normalized=normalizePlan(plan); const active=normalized.tracks.filter((track)=>track._samples.length); if(!active.length) throw new Error('Fragmented MP4 segment requires samples');
  let moof=buildMoof(active,sequenceNumber,new Map()); let offsets=new Map();
  for(let pass=0;pass<2;pass++){let payloadOffset=moof.length+8;offsets=new Map();for(const track of active){offsets.set(track.id,payloadOffset);payloadOffset+=track._samples.reduce((sum,sample)=>sum+sample.payload.length,0);}moof=buildMoof(active,sequenceNumber,offsets);}
  const mdat=box('mdat',...active.flatMap((track)=>track._samples.map((sample)=>sample.payload))); return concat([moof,mdat]);
}
export function muxFragmentedMp4(plan,options={}) { return { initSegment:createFragmentedMp4Init(plan,options), mediaSegment:createFragmentedMp4Segment(plan,options) }; }
