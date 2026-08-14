import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIsoBoxesForEncryption, parseTenc, parseSenc, parseSaiz, parseSaio, parseSbgp, parseSgpdSeig, resolveCencSampleEncryption } from '../src/isobmff-encryption.js';
const te=new TextEncoder();
const u8=(...v)=>new Uint8Array(v.flat());
const u16=(n)=>u8((n>>8)&255,n&255);
const u32=(n)=>u8((n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255);
const cat=(...parts)=>{const a=parts.flat().map((p)=>p instanceof Uint8Array?p:new Uint8Array(p)),o=new Uint8Array(a.reduce((n,p)=>n+p.length,0));let x=0;for(const p of a){o.set(p,x);x+=p.length;}return o;};
const box=(type,...parts)=>{const body=cat(...parts);return cat(u32(body.length+8),te.encode(type),body);};
const full=(type,version,flags,...parts)=>box(type,u8(version,(flags>>16)&255,(flags>>8)&255,flags&255),...parts);
const kid=u8(...Array.from({length:16},(_,i)=>i+1));

test('parses tenc version 1 pattern, KID and constant IV',()=>{
  const bytes=full('tenc',1,0,u8(0,0x21,0,1,0),kid,u8(8,1,2,3,4,5,6,7,8));
  const parsed=parseTenc(bytes,parseIsoBoxesForEncryption(bytes)[0]);
  assert.equal(parsed.cryptByteBlock,2);assert.equal(parsed.skipByteBlock,1);assert.equal(parsed.isProtected,true);assert.equal(parsed.perSampleIvSize,0);assert.equal(parsed.keyId,'0102030405060708090a0b0c0d0e0f10');assert.deepEqual([...parsed.constantIv],[1,2,3,4,5,6,7,8]);
});

test('parses senc subsample encryption and auxiliary tables',()=>{
  const sencBytes=full('senc',0,2,u32(1),u8(1,2,3,4,5,6,7,8),u16(2),u16(5),u32(100),u16(2),u32(50));
  const senc=parseSenc(sencBytes,parseIsoBoxesForEncryption(sencBytes)[0],{ivSize:8});
  assert.equal(senc.sampleCount,1);assert.equal(senc.samples[0].ivHex,'0102030405060708');assert.deepEqual(senc.samples[0].subsamples,[{clearBytes:5,encryptedBytes:100},{clearBytes:2,encryptedBytes:50}]);
  const saizBytes=full('saiz',0,0,u8(0),u32(2),u8(8,14));
  assert.deepEqual(parseSaiz(saizBytes,parseIsoBoxesForEncryption(saizBytes)[0]).sampleInfoSizes,[8,14]);
  const saioBytes=full('saio',1,0,u32(2),u32(0),u32(123),u32(1),u32(5));
  assert.deepEqual(parseSaio(saioBytes,parseIsoBoxesForEncryption(saioBytes)[0]).offsets,[123,4294967301]);
});

test('sample encryption groups override track defaults without decrypting',()=>{
  const sgpdEntry=cat(u8(0,0x32,0,1,8),kid);
  const sgpdBytes=full('sgpd',1,0,te.encode('seig'),u32(sgpdEntry.length),u32(1),sgpdEntry);
  const sbgpBytes=full('sbgp',0,0,te.encode('seig'),u32(2),u32(1),u32(0),u32(2),u32(1));
  const sgpd=parseSgpdSeig(sgpdBytes,parseIsoBoxesForEncryption(sgpdBytes)[0]);
  const sbgp=parseSbgp(sbgpBytes,parseIsoBoxesForEncryption(sbgpBytes)[0]);
  const resolved=resolveCencSampleEncryption({trackEncryption:{isProtected:false,perSampleIvSize:0,keyId:null},sgpd,sbgp,sampleCount:3});
  assert.equal(resolved[0].encrypted,false);assert.equal(resolved[1].encrypted,true);assert.equal(resolved[2].encrypted,true);assert.equal(resolved[1].cryptByteBlock,3);assert.equal(resolved[1].skipByteBlock,2);assert.equal(resolved[1].keyId,'0102030405060708090a0b0c0d0e0f10');
});
test('parses PSSH system id, key ids and opaque init data',async()=>{const {parsePssh}=await import('../src/isobmff-encryption.js'),system=u8(...Array.from({length:16},(_,i)=>0xa0+i)),key=u8(...Array.from({length:16},(_,i)=>0xb0+i)),bytes=full('pssh',1,0,system,u32(1),key,u32(3),u8(9,8,7)),parsed=parsePssh(bytes,parseIsoBoxesForEncryption(bytes)[0]);assert.equal(parsed.systemId,'a0a1a2a3a4a5a6a7a8a9aaabacadaeaf');assert.equal(parsed.keyIds[0],'b0b1b2b3b4b5b6b7b8b9babbbcbdbebf');assert.equal(parsed.dataHex,'090807');});
