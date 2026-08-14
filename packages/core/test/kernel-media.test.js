import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DemuxerRegistry, assertEncodedChunkSequence, chunkWindow, createDemuxPlan, createEncodedChunkDescriptor,
  createTrackDescriptor, decoderConfigForTrack, microsToSeconds, secondsToMicros, sniffContainer,
} from '../src/media-kernel.js';
import { decodeWavPcm, parseWav } from '../src/wav.js';
import { findIsoBoxes, parseFtyp, parseIsoBoxes, parseIsoMovieSummary, parseMvhd } from '../src/isobmff.js';
import { parseEbmlElements, parseEbmlHeader, readEbmlElementHeader, readEbmlVint } from '../src/ebml.js';
import { createSeekIndex, decodeWindowFromSeekIndex, nearestKeyframe, prefetchWindows } from '../src/seek-index.js';

test('sniffs common containers from metadata and signatures', () => {
  assert.equal(sniffContainer({ mimeType: 'video/mp4' }), 'mp4');
  assert.equal(sniffContainer({ name: 'clip.MOV' }), 'mov');
  assert.equal(sniffContainer({ bytes: new Uint8Array([0x52,0x49,0x46,0x46,0,0,0,0,0x57,0x41,0x56,0x45]) }), 'wav');
  assert.equal(sniffContainer({ bytes: new Uint8Array([0x1a,0x45,0xdf,0xa3,0,0,0,0,0,0,0,0]) }), 'webm');
});
test('converts media timestamps without drift for integer micros', () => { assert.equal(secondsToMicros(1.25), 1_250_000); assert.equal(microsToSeconds(1_250_000), 1.25); });
test('creates decoder-ready video and audio track descriptors', () => {
  const video = createTrackDescriptor({ id:'v1', type:'video', codec:'avc1.640028', width:1920, height:1080, duration:5 });
  const audio = createTrackDescriptor({ id:'a1', type:'audio', codec:'mp4a.40.2', sampleRate:48000, channels:2, duration:5 });
  assert.deepEqual(decoderConfigForTrack(video), { codec:'avc1.640028', codedWidth:1920, codedHeight:1080, description:undefined });
  assert.deepEqual(decoderConfigForTrack(audio), { codec:'mp4a.40.2', sampleRate:48000, numberOfChannels:2, description:undefined });
});
test('rejects invalid track descriptors', () => { assert.throws(() => createTrackDescriptor({ id:'x', type:'video', codec:'h264', width:0, height:1080 }), /positive/); assert.throws(() => createTrackDescriptor({ id:'x', type:'bogus', codec:'x' }), /Unsupported track type/); });
test('creates normalized demux plan and deduplicates seek points', () => { const track = createTrackDescriptor({ id:'v', type:'video', codec:'vp09', width:1280, height:720, duration:10 }); const plan = createDemuxPlan({ container:'webm', duration:10, tracks:[track], seekPoints:[5,1,5,20] }); assert.deepEqual(plan.seekPoints, [1,5]); });
test('rejects duplicate demux track ids', () => { const track = createTrackDescriptor({ id:'v', type:'video', codec:'vp09', width:1280, height:720 }); assert.throws(() => createDemuxPlan({ container:'webm', tracks:[track, track] }), /Duplicate/); });
test('normalizes encoded chunk descriptors', () => { const chunk = createEncodedChunkDescriptor({ trackId:'v', type:'key', timestamp:1000.2, duration:33333.4, byteLength:900.5, sequence:2 }); assert.deepEqual(chunk, { trackId:'v', type:'key', timestamp:1000, duration:33333, byteLength:901, offset:null, sequence:2 }); });
test('validates per-track encoded chunk ordering', () => { const chunks = [createEncodedChunkDescriptor({ trackId:'v', type:'key', timestamp:0, sequence:0 }),createEncodedChunkDescriptor({ trackId:'a', type:'key', timestamp:0, sequence:0 }),createEncodedChunkDescriptor({ trackId:'v', timestamp:33_333, sequence:1 })]; assert.equal(assertEncodedChunkSequence(chunks, { requireInitialKeyframe:true }), chunks); assert.throws(() => assertEncodedChunkSequence([createEncodedChunkDescriptor({ trackId:'v', timestamp:10, sequence:2 }),createEncodedChunkDescriptor({ trackId:'v', timestamp:5, sequence:3 })]), /Non-monotonic/); });
test('expands chunk window to preceding keyframe', () => { const chunks = [0,1,2,3,4].map((second, index) => createEncodedChunkDescriptor({ trackId:'v', type:index===0||index===3?'key':'delta', timestamp:secondsToMicros(second), duration:secondsToMicros(1), sequence:index })); const window = chunkWindow(chunks, { start:3.5, end:4.5, trackId:'v' }); assert.equal(window[0].timestamp, secondsToMicros(3)); });
test('demuxer registry ranks probes and creates best adapter', async () => { const registry = new DemuxerRegistry().register('weak', { probe: async () => 0.3, create: async () => 'weak' }).register('strong', { probe: async () => 0.9, create: async () => 'strong' }); assert.deepEqual((await registry.probe({})).map((x) => x.id), ['strong','weak']); assert.equal(await registry.create({}), 'strong'); });

function wav16(samples,{channels=1,sampleRate=8000}={}){const dataSize=samples.length*2;const buffer=new ArrayBuffer(44+dataSize);const view=new DataView(buffer);const text=(o,s)=>[...s].forEach((c,i)=>view.setUint8(o+i,c.charCodeAt(0)));text(0,'RIFF');view.setUint32(4,36+dataSize,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,channels,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*channels*2,true);view.setUint16(32,channels*2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,dataSize,true);samples.forEach((v,i)=>view.setInt16(44+i*2,v,true));return buffer;}
test('parses PCM WAV metadata',()=>{const parsed=parseWav(wav16([0,32767,-32768,0]));assert.equal(parsed.format.sampleRate,8000);assert.equal(parsed.frameCount,4);});
test('decodes signed 16-bit WAV to float PCM',()=>{const {pcm}=decodeWavPcm(wav16([0,32767,-32768]));assert.equal(pcm.channels[0][0],0);assert.ok(pcm.channels[0][1]>.999);assert.equal(pcm.channels[0][2],-1);});
test('decodes interleaved stereo WAV',()=>{const {pcm}=decodeWavPcm(wav16([32767,0,0,-32768],{channels:2}));assert.equal(pcm.length,2);assert.ok(pcm.channels[0][0]>.999);assert.equal(pcm.channels[1][1],-1);});
test('rejects non-WAV and unsupported WAV codec',()=>{assert.throws(()=>parseWav(new Uint8Array(20)),/RIFF\/WAVE/);const buffer=wav16([0]);new DataView(buffer).setUint16(20,6,true);assert.throws(()=>parseWav(buffer),/Unsupported WAV format/);});

function box(type,payload=new Uint8Array()){const out=new Uint8Array(8+payload.length);const view=new DataView(out.buffer);view.setUint32(0,out.length,false);[...type].forEach((c,i)=>out[4+i]=c.charCodeAt(0));out.set(payload,8);return out;}
function concat(...arrays){const out=new Uint8Array(arrays.reduce((n,a)=>n+a.length,0));let o=0;for(const a of arrays){out.set(a,o);o+=a.length;}return out;}
test('parses top-level ISO-BMFF boxes',()=>{const data=concat(box('free',new Uint8Array(4)),box('mdat',new Uint8Array(6)));assert.deepEqual(parseIsoBoxes(data).map((b)=>b.type),['free','mdat']);});
test('parses ftyp brands',()=>{const payload=new Uint8Array(16);payload.set([...Buffer.from('isom')],0);new DataView(payload.buffer).setUint32(4,512,false);payload.set([...Buffer.from('isommp42')],8);const parsed=parseFtyp(box('ftyp',payload));assert.equal(parsed.majorBrand,'isom');assert.deepEqual(parsed.compatibleBrands,['isom','mp42']);});
test('parses version-zero movie duration',()=>{const payload=new Uint8Array(20);const view=new DataView(payload.buffer);view.setUint8(0,0);view.setUint32(12,1000,false);view.setUint32(16,5000,false);const mvhdBox=box('mvhd',payload);assert.equal(parseMvhd(mvhdBox,parseIsoBoxes(mvhdBox)[0]).durationSeconds,5);});
test('summarizes nested moov movie header',()=>{const ftypPayload=new Uint8Array(8);ftypPayload.set([...Buffer.from('isom')]);const mvhdPayload=new Uint8Array(20);const view=new DataView(mvhdPayload.buffer);view.setUint32(12,30,false);view.setUint32(16,90,false);const file=concat(box('ftyp',ftypPayload),box('moov',box('mvhd',mvhdPayload)));assert.equal(parseIsoMovieSummary(file).movie.durationSeconds,3);assert.equal(findIsoBoxes(file,'moov').length,1);});
test('rejects malformed ISO-BMFF box sizes',()=>{const bad=new Uint8Array(8);new DataView(bad.buffer).setUint32(0,4,false);bad.set([...Buffer.from('free')],4);assert.throws(()=>parseIsoBoxes(bad),/Invalid ISO-BMFF box/);});

test('reads EBML variable integers and elements',()=>{assert.deepEqual(readEbmlVint(new Uint8Array([0x85])),{length:1,value:5});assert.equal(readEbmlVint(new Uint8Array([0x40,0x7f])).value,127);const element=readEbmlElementHeader(new Uint8Array([0x81,0x83,1,2,3]));assert.equal(element.size,3);assert.equal(parseEbmlElements(new Uint8Array([0x81,0x81,7,0x82,0x82,8,9])).length,2);});
test('parses WebM EBML DocType',()=>{const doc=new Uint8Array([0x42,0x82,0x84,...Buffer.from('webm')]);const header=new Uint8Array([0x1a,0x45,0xdf,0xa3,0x80|doc.length,...doc]);assert.equal(parseEbmlHeader(header).container,'webm');});
test('rejects truncated EBML values',()=>assert.throws(()=>readEbmlVint(new Uint8Array([0x40])),/Truncated/));

const seekChunks=[0,1,2,3,4,5].map((s,i)=>({trackId:'v',type:i===0||i===3?'key':'delta',timestamp:s*1_000_000,duration:1_000_000,sequence:i}));
test('builds seek index with keyframes',()=>{const index=createSeekIndex(seekChunks);assert.deepEqual(index.tracks.v.keyframes.map((x)=>x.time),[0,3]);});
test('finds keyframes in multiple directions',()=>{const index=createSeekIndex(seekChunks);assert.equal(nearestKeyframe(index,'v',4).time,3);assert.equal(nearestKeyframe(index,'v',1,{direction:'forward'}).time,3);assert.equal(nearestKeyframe(index,'v',2.2,{direction:'nearest'}).time,3);});
test('creates safe decode and prefetch windows',()=>{const index=createSeekIndex(seekChunks);assert.equal(decodeWindowFromSeekIndex(index,'v',{time:4,ahead:1}).start,3);assert.ok(prefetchWindows(index,['v'],{time:2,direction:1,horizon:2})[0].end>2);});
