import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultKernelRuntime, inspectContainerPayload } from '../kernel-handlers.js';
import { InlineKernelClient } from '../kernel-client.js';
import { createKernelTask } from '../../../packages/core/src/kernel-protocol.js';
import { KernelRuntime } from '../../../packages/core/src/kernel-runtime.js';
function wav(){const buffer=new ArrayBuffer(46);const view=new DataView(buffer);const text=(o,s)=>[...s].forEach((c,i)=>view.setUint8(o+i,c.charCodeAt(0)));text(0,'RIFF');view.setUint32(4,38,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,8000,true);view.setUint32(28,16000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,2,true);view.setInt16(44,32767,true);return buffer;}
test('inspects WAV payload into demux plan',()=>{const plan=inspectContainerPayload({name:'tone.wav',bytes:wav()});assert.equal(plan.container,'wav');assert.equal(plan.tracks[0].sampleRate,8000);});
test('default runtime decodes WAV audio',async()=>{const runtime=createDefaultKernelRuntime();const result=await runtime.execute(createKernelTask('decode-audio',{name:'tone.wav',bytes:wav()},{id:'a'}));assert.equal(result.type,'result');assert.equal(result.result.sampleRate,8000);});
test('default runtime rejects unsupported audio containers honestly',async()=>{const result=await createDefaultKernelRuntime().execute(createKernelTask('decode-audio',{name:'x.mp3',bytes:new Uint8Array([1,2,3]).buffer},{id:'b'}));assert.equal(result.type,'error');assert.match(result.error.message,/supports WAV only/);});
test('inline client resolves and forwards progress',async()=>{const seen=[];const runtime=new KernelRuntime().register('proxy',async(_payload,{progress})=>{progress(.5);return{ok:true};});const client=new InlineKernelClient({runtime});const result=await client.run('proxy',{}, {id:'p',onProgress:(m)=>seen.push(m.progress)}).promise;assert.deepEqual(result,{ok:true});assert.deepEqual(seen,[.5]);});
test('inline client rejects structured errors',async()=>{const runtime=new KernelRuntime().register('mux',async()=>{throw new Error('bad mux');});const client=new InlineKernelClient({runtime});await assert.rejects(client.run('mux',{}, {id:'m'}).promise,/bad mux/);});
