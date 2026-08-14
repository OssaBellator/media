import test from 'node:test';
import assert from 'node:assert/strict';
import { BlobRangeSource, HttpRangeSource } from '../media-source.js';

test('BlobRangeSource reads slices without materializing the entire blob',async()=>{const source=new BlobRangeSource(new Blob([Uint8Array.from({length:100},(_,i)=>i)]));assert.deepEqual([...await source.read(20,5)],[20,21,22,23,24]);assert.equal(source.stats().bytesRead,5);});

test('HttpRangeSource sends byte ranges and accepts 206 responses',async()=>{const sourceBytes=Uint8Array.from({length:50},(_,i)=>i),requests=[];const fetchImpl=async(_url,options={})=>{const header=options.headers?.Range;requests.push(header);const match=header.match(/bytes=(\d+)-(\d+)/),start=Number(match[1]),end=Number(match[2]);return new Response(sourceBytes.slice(start,end+1),{status:206,headers:{'Content-Range':`bytes ${start}-${end}/${sourceBytes.length}`}});};const source=await HttpRangeSource.create('https://example.test/video.mp4',{size:sourceBytes.length,fetchImpl});assert.deepEqual([...await source.read(7,4)],[7,8,9,10]);assert.equal(requests[0],'bytes=7-10');});

test('HttpRangeSource safely caches a server that ignores Range',async()=>{const sourceBytes=Uint8Array.from({length:20},(_,i)=>i),fetchImpl=async()=>new Response(sourceBytes,{status:200,headers:{'Content-Length':String(sourceBytes.length)}});const source=await HttpRangeSource.create('https://example.test/video.mp4',{fetchImpl});assert.deepEqual([...await source.read(5,3)],[5,6,7]);assert.equal(source.stats().fullFallback,true);});
