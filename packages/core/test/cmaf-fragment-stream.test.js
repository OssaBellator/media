import test from 'node:test';
import assert from 'node:assert/strict';
import {CmafFragmentAssembler} from '../src/cmaf-fragment-stream.js';

function box(type,payload=[]){
  const bytes=new Uint8Array(8+payload.length),view=new DataView(bytes.buffer);
  view.setUint32(0,bytes.length,false);
  for(let i=0;i<4;i++)bytes[4+i]=type.charCodeAt(i);
  bytes.set(payload,8);return bytes;
}
function join(...parts){const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let o=0;for(const p of parts){out.set(p,o);o+=p.length;}return out;}

test('emits a moof+mdat unit as soon as both complete',()=>{
  const styp=box('styp',[1]),moof=box('moof',[2,3]),mdat=box('mdat',[4,5,6]),stream=new CmafFragmentAssembler({id:'s'});
  assert.deepEqual(stream.append(join(styp,moof,mdat.slice(0,5))),[]);
  const emitted=stream.append(mdat.slice(5));
  assert.equal(emitted.length,1);assert.equal(emitted[0].id,'s:0');assert.deepEqual([...emitted[0].bytes],[...join(styp,moof,mdat)]);
  assert.equal(stream.stats().bufferedBytes,0);
});
test('one append can emit multiple fragment units',()=>{
  const first=join(box('moof',[1]),box('mdat',[2])),second=join(box('moof',[3]),box('mdat',[4,5])),stream=new CmafFragmentAssembler();
  const emitted=stream.append(join(first,second));
  assert.equal(emitted.length,2);assert.deepEqual([...emitted[0].bytes],[...first]);assert.deepEqual([...emitted[1].bytes],[...second]);
});
test('rejects a second moof before the current mdat',()=>{
  const stream=new CmafFragmentAssembler();
  assert.throws(()=>stream.append(join(box('moof'),box('moof'))),/second moof/);
});
test('close rejects truncated boxes and accepts complete non-fragment trailers',()=>{
  const truncated=box('mdat',[1,2,3]).slice(0,9),stream=new CmafFragmentAssembler();stream.append(truncated);
  assert.throws(()=>stream.close(),/incomplete/);
  const trailer=new CmafFragmentAssembler();trailer.append(box('emsg',[7]));assert.deepEqual(trailer.close(),[]);assert.equal(trailer.stats().closed,true);
});
test('buffer limit rejects unbounded partial boxes',()=>{
  const bytes=new Uint8Array(1200),view=new DataView(bytes.buffer);view.setUint32(0,2000,false);bytes.set([109,100,97,116],4);
  const stream=new CmafFragmentAssembler({maxBufferBytes:1024,maxBoxBytes:4096});
  assert.throws(()=>stream.append(bytes),/buffer limit/);
});
