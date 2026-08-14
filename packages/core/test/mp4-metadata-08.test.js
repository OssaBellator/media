import assert from 'node:assert/strict';
import test from 'node:test';
import { muxMp4, createFragmentedMp4Init } from '../src/isobmff-mux.js';

const decoderBytes = new Uint8Array([1,2,3,4]);
function plan(codec,{metadata=true,rotation=0}={}){
  const config={width:640,height:360,codedWidth:640,codedHeight:360,description:decoderBytes,rotation};
  if(metadata)Object.assign(config,{colorSpace:{primaries:'bt2020',transfer:'pq',matrix:'bt2020-ncl',fullRange:false},pixelAspectRatio:{hSpacing:4,vSpacing:3},contentLightLevel:{maxCLL:1000,maxFALL:400},masteringDisplay:{primaries:[13250,34500,7500,3000,34000,16000],whitePoint:[15635,16450],maxLuminance:10_000_000,minLuminance:50}});
  return{container:'mp4',tracks:[{id:'v',type:'video',codec,config}],samples:[{trackId:'v',timestamp:0,dts:0,duration:33_333,keyframe:true,payload:new Uint8Array([9,8,7])}]};
}
function text(bytes){return Buffer.from(bytes).toString('latin1');}

test('classic MP4 writer emits HEVC hvcC sample entries', () => {
  const bytes=muxMp4(plan('hvc1.1.6.L93.B0'));
  const content=text(bytes);
  assert.ok(content.includes('hvc1'));
  assert.ok(content.includes('hvcC'));
  assert.ok(content.includes('mdat'));
});

test('classic MP4 writer emits AV1 av1C sample entries', () => {
  const bytes=muxMp4(plan('av01.0.08M.08'));
  const content=text(bytes);
  assert.ok(content.includes('av01'));
  assert.ok(content.includes('av1C'));
});

test('video sample entries include color HDR and pixel aspect metadata boxes', () => {
  const content=text(muxMp4(plan('hvc1.1.6.L93.B0')));
  for(const type of ['colr','pasp','clli','mdcv'])assert.ok(content.includes(type), `${type} should be present`);
  assert.ok(content.includes('nclx'));
});

test('fragmented MP4 init supports AV1 metadata and rotated track matrix', () => {
  const rotated=createFragmentedMp4Init(plan('av01.0.08M.08',{rotation:90}));
  const straight=createFragmentedMp4Init(plan('av01.0.08M.08',{rotation:0}));
  assert.ok(text(rotated).includes('mvex'));
  assert.ok(text(rotated).includes('av1C'));
  assert.notDeepEqual([...rotated], [...straight], 'rotation should change tkhd matrix bytes');
});

test('MP4 writer rejects HEVC/AV1 tracks without decoder configuration', () => {
  const value=plan('hvc1.1.6.L93.B0');delete value.tracks[0].config.description;
  assert.throws(()=>muxMp4(value),/requires .* decoder description/i);
});

import { createMuxPlanFromEncoded } from '../src/encoded-export.js';
test('encoded export bridge preserves video color, rotation, aspect and HDR metadata', () => {
  const metadata={colorSpace:{primaries:'bt2020'},rotation:90,pixelAspectRatio:{hSpacing:4,vSpacing:3},contentLightLevel:{maxCLL:1000,maxFALL:400},masteringDisplay:{primaries:[13250,34500,7500,3000,34000,16000],whitePoint:[15635,16450],maxLuminance:10_000_000,minLuminance:50}};
  const mux=createMuxPlanFromEncoded({container:'mp4',streams:[{type:'video',id:'v',codec:'hvc1.1.6.L93.B0',width:640,height:360,...metadata,chunks:[{timestamp:0,dts:0,duration:33_333,type:'key',keyframe:true,payload:new Uint8Array([1]).buffer,decoderConfig:{codec:'hvc1.1.6.L93.B0',description:new Uint8Array([1,2,3]).buffer}}]}]});
  for(const key of Object.keys(metadata))assert.deepEqual(mux.tracks[0].config[key],metadata[key]);
  const output=muxMp4(mux);for(const type of ['hvcC','colr','pasp','clli','mdcv'])assert.ok(text(output).includes(type));
});

import { parseTkhdRotation, parseVideoSampleMetadata } from '../src/isobmff-metadata.js';
function descriptor(bytes,type){const buffer=Buffer.from(bytes),index=buffer.indexOf(type,'latin1');if(index<4)throw new Error(`box ${type} not found`);const offset=index-4,size=buffer.readUInt32BE(offset);return{type,offset,size,headerSize:8,dataOffset:offset+8,end:offset+size,dataSize:size-8};}
test('MP4 presentation metadata round-trips through metadata parsers', () => {
  const bytes=muxMp4(plan('hvc1.1.6.L93.B0',{rotation:90}));
  const nested=['colr','pasp','clli','mdcv'].map((type)=>descriptor(bytes,type));
  const meta=parseVideoSampleMetadata(bytes,nested);
  assert.equal(meta.colorSpace.primaries,'bt2020');assert.equal(meta.colorSpace.transfer,'pq');assert.equal(meta.colorSpace.matrix,'bt2020-ncl');
  assert.deepEqual(meta.pixelAspectRatio,{hSpacing:4,vSpacing:3});
  assert.deepEqual(meta.contentLightLevel,{maxCLL:1000,maxFALL:400});
  assert.deepEqual(meta.masteringDisplay.primaries,[13250,34500,7500,3000,34000,16000]);
  assert.equal(parseTkhdRotation(bytes,descriptor(bytes,'tkhd')),90);
});
