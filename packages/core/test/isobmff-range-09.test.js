import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRangeSource } from '../src/range-source.js';
import { scanIsoTopLevelSource, readIsoSampleFromSource } from '../src/isobmff-range.js';

function u32(value){const bytes=new Uint8Array(4);new DataView(bytes.buffer).setUint32(0,value,false);return bytes;}
function box(type,payloadLength){const out=new Uint8Array(8+payloadLength);out.set(u32(out.length),0);out.set(new TextEncoder().encode(type),4);return out;}
function concat(parts){const out=new Uint8Array(parts.reduce((sum,p)=>sum+p.length,0));let offset=0;for(const part of parts){out.set(part,offset);offset+=part.length;}return out;}

test('top-level range scanner skips large payloads and reads only headers', async () => {
  const file=concat([box('ftyp',8),box('mdat',1024*1024),box('moov',32)]);
  const source=new MemoryRangeSource(file);
  const result=await scanIsoTopLevelSource(source);
  assert.deepEqual(result.boxes.map((item)=>item.type),['ftyp','mdat','moov']);
  assert.ok(source.bytesRead < 64);
  assert.equal(result.boxes[1].size,1024*1024+8);
});

test('top-level scanner handles size-zero terminal boxes', async () => {
  const head=box('ftyp',8),tail=new Uint8Array(24);tail.set(u32(0),0);tail.set(new TextEncoder().encode('mdat'),4);
  const source=new MemoryRangeSource(concat([head,tail]));
  const result=await scanIsoTopLevelSource(source);
  assert.equal(result.boxes[1].size,24);
});

test('sample reads use absolute source offsets', async () => {
  const source=new MemoryRangeSource(Uint8Array.from({length:20},(_,i)=>i));
  const bytes=await readIsoSampleFromSource(source,{offset:7,byteLength:4});
  assert.deepEqual([...bytes],[7,8,9,10]);
});
