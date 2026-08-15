import test from 'node:test';import assert from 'node:assert/strict';
import {parseTsPackets,parseTsPacket,TsContinuityTracker} from '../src/mpegts-packet.js';
import {parsePatSection,parsePmtSection} from '../src/mpegts-psi.js';
import {TimestampUnwrapper,parsePesPacket,ticksToMicros} from '../src/mpegts-pes.js';
import {AdtsFrameAssembler,parseAdtsHeader} from '../src/mpegts-audio.js';
import {parseH264Sps,inspectAnnexB} from '../src/mpegts-video.js';
import {demuxMpegTs,MpegTsSegmentSession} from '../src/mpegts-demux.js';
import {tsPacket,patSection,pmtSection,adtsFrame,pes,packetizePes,concat,basicAacTs,basicVideoTs} from './ts-fixture.js';

test('TS packet parser exposes PID/start/continuity',()=>{const p=parseTsPacket(tsPacket(0x123,Uint8Array.of(1,2),{start:true,cc:7}));assert.equal(p.pid,0x123);assert.equal(p.payloadUnitStart,true);assert.equal(p.continuityCounter,7);});
test('TS packet scanner finds aligned packets',()=>{const bytes=concat(tsPacket(0,Uint8Array.of()),tsPacket(0x100,Uint8Array.of()));assert.equal(parseTsPackets(bytes).packets.length,2);});
test('continuity tracker records gaps',()=>{const t=new TsContinuityTracker();t.observe(parseTsPacket(tsPacket(1,Uint8Array.of(1),{cc:0})));assert.equal(t.observe(parseTsPacket(tsPacket(1,Uint8Array.of(2),{cc:2}))),false);assert.equal(t.errors.length,1);});
test('PAT discovers PMT PID',()=>assert.equal(parsePatSection(patSection(0x234)).programs[0].pmtPid,0x234));
test('PMT maps AVC and AAC stream types',()=>{const p=parsePmtSection(pmtSection([{type:0x1b,pid:0x101},{type:0x0f,pid:0x102}]));assert.deepEqual(p.streams.map(s=>s.kind),['video','audio']);});
test('timestamp unwrap crosses 33-bit rollover',()=>{const u=new TimestampUnwrapper();const near=2**33-100;assert.equal(u.unwrap(near),near);assert.equal(u.unwrap(50),2**33+50);});
test('PES timestamp converts to microseconds',()=>{const packet=parsePesPacket(pes(0xe0,Uint8Array.of(1),{pts:90_000}));assert.equal(ticksToMicros(packet.pts),1_000_000);});
test('ADTS frame assembler survives split frame',()=>{const frame=adtsFrame(Uint8Array.of(1,2,3,4));const a=new AdtsFrameAssembler();assert.equal(a.push(frame.subarray(0,5)).length,0);const out=a.push(frame.subarray(5),{timestampMicros:1_000});assert.equal(out.length,1);assert.equal(out[0].sampleRate,44100);assert.deepEqual([...out[0].data],[1,2,3,4]);});
test('ADTS header exposes decoder config',()=>{const h=parseAdtsHeader(adtsFrame(Uint8Array.of(9)));assert.equal(h.codec,'mp4a.40.2');assert.equal(h.channels,2);assert.equal(h.description.length,2);});
test('H264 SPS exposes 1920x1080 and codec string',()=>{const sps=Uint8Array.from(Buffer.from('6764001facd940780227e5c044000003000400000300f1831960','hex')),info=parseH264Sps(sps);assert.equal(info.width,1920);assert.equal(info.height,1080);assert.equal(info.codec,'avc1.64001F');});
test('Annex B IDR is a keyframe',()=>{const bytes=Uint8Array.from([0,0,0,1,0x67,0x64,0,0x1f,0,0,1,0x65,1,2]);assert.equal(inspectAnnexB(bytes).key,true);});
test('AAC TS demux produces raw AAC chunk and track',()=>{const result=demuxMpegTs(basicAacTs());assert.equal(result.tracks[0].type,'audio');assert.equal(result.tracks[0].codec,'mp4a.40.2');assert.deepEqual([...result.chunks[0].payload],[1,2,3,4]);assert.equal(result.chunks[0].timestamp,1_000_000);});
test('transport scrambling is rejected before decode',()=>{const bytes=basicAacTs(),packet=tsPacket(0x101,Uint8Array.of(0,0,1,0xc0,0,0,0x80,0,0),{start:true,cc:0,scrambling:2}),source=concat(bytes.subarray(0,376),packet);assert.throws(()=>demuxMpegTs(source),e=>e.code==='ERR_ENCRYPTED_MEDIA');});
test('bounded TS session evicts and acknowledges segments',()=>{const session=new MpegTsSegmentSession({maxSegments:2});session.push(basicAacTs({pts:0}),{id:'a'});session.push(basicAacTs({pts:90_000}),{id:'b'});session.push(basicAacTs({pts:180_000}),{id:'c'});assert.deepEqual(session.stats().ids,['b','c']);assert.equal(session.acknowledge('b'),true);assert.deepEqual(session.stats().ids,['c']);});
test('TS session carries timestamp wrap across segments',()=>{const session=new MpegTsSegmentSession();const a=session.push(basicAacTs({pts:2**33-90_000}),{id:'a'}).result.chunks[0].timestamp,b=session.push(basicAacTs({pts:45_000}),{id:'b'}).result.chunks[0].timestamp;assert.ok(b>a);});
test('TS discontinuity resets timestamp epoch',()=>{const session=new MpegTsSegmentSession();session.push(basicAacTs({pts:2**33-90_000}),{id:'a'});const b=session.push(basicAacTs({pts:45_000}),{id:'b',discontinuity:true}).result.chunks[0].timestamp;assert.ok(b<1_000_000);});

test('H264 TS demux promotes SPS dimensions and keyframe metadata',()=>{const result=demuxMpegTs(basicVideoTs());const track=result.tracks[0],chunk=result.chunks[0];assert.equal(track.width,1920);assert.equal(track.height,1080);assert.equal(track.codec,'avc1.64001F');assert.equal(chunk.type,'key');});
test('multi-packet video PES reconstructs as one elementary payload',()=>{const result=demuxMpegTs(basicVideoTs({extraBytes:400}));assert.equal(result.chunks.length,1);assert.ok(result.chunks[0].payload.length>400);});
