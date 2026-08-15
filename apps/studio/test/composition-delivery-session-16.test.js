import test from 'node:test';
import assert from 'node:assert/strict';
import { CompositionDeliverySession, deliveryCodecOptions } from '../composition-delivery-session.js';

const graph={nodes:{o:{id:'o',kind:'output',name:'Master',props:{format:'mp4',width:1920,height:1080,fps:24,compositionId:'c',includeAudio:true}}}};

test('codec policy maps MP4 and WebM to supported delivery families',()=>{
  const mp4=deliveryCodecOptions(graph.nodes.o,'mp4',{hasAudio:true}),webm=deliveryCodecOptions(graph.nodes.o,'webm',{hasAudio:true});
  assert.equal(mp4.videoConfig.codec,'avc1.640028');assert.equal(mp4.audioConfig.codec,'mp4a.40.2');
  assert.equal(webm.videoConfig.codec,'vp09.00.10.08');assert.equal(webm.audioConfig.codec,'opus');
  assert.equal(mp4.videoConfig.framerate,24);
});

test('direct graph delivery forwards composition fidelity and offline audio',async()=>{
  let exportOptions=null,audioCalls=0,closed=0;
  const session=new CompositionDeliverySession({createManifest:()=>({settings:{width:1920,height:1080,fps:24,rangeStart:0,rangeEnd:1}}),createFrameRenderer:()=>({close(){closed++;}}),audioPlanForOutput:()=>({sources:[{assetId:'a'}]}),renderOfflineAudio:async()=>{audioCalls++;return{sampleRate:48000,length:0,channels:[]};},renderExport:async(options)=>{exportOptions=options;await options.renderAudioPcm({start:0,end:1,sampleRate:48000,signal:options.signal});return{bytes:new Uint8Array([1,2,3])};}});
  const result=await session.render(graph,'o',{temporalSamples:6,vectorSupersample:3});
  assert.equal(result.hasAudio,true);assert.equal(exportOptions.graph,graph);assert.equal(exportOptions.temporalSamples,6);assert.equal(exportOptions.vectorSupersample,3);assert.equal(exportOptions.videoConfig.width,1920);assert.equal(audioCalls,1);assert.equal(closed,1);assert.equal(session.stats().completed,1);
});

test('audio cannot be silently dropped',async()=>{
  const session=new CompositionDeliverySession({createManifest:()=>({settings:{}}),createFrameRenderer:()=>({}),audioPlanForOutput:()=>({sources:[{}]}),renderExport:async()=>({})});
  await assert.rejects(()=>session.render(graph,'o'),/no offline audio renderer/);assert.equal(session.stats().active,0);assert.equal(session.stats().failed,1);
});

test('progressive delivery requires sink before starting',async()=>{
  const session=new CompositionDeliverySession({createManifest:()=>({settings:{}}),createFrameRenderer:()=>({}),audioPlanForOutput:()=>({sources:[]}),renderExport:async()=>({})});
  await assert.rejects(()=>session.render(graph,'o',{progressive:true}),/requires a sink/);assert.equal(session.stats().renders,0);
});

test('new render for same output cancels prior render',async()=>{
  let started=0;
  const session=new CompositionDeliverySession({createManifest:()=>({settings:{}}),createFrameRenderer:()=>({}),audioPlanForOutput:()=>({sources:[]}),renderExport:({signal})=>new Promise((resolve,reject)=>{started++;signal.addEventListener('abort',()=>reject(signal.reason),{once:true});if(started===2)resolve({bytes:new Uint8Array()});})});
  const first=session.render(graph,'o');await new Promise((resolve)=>setTimeout(resolve,0));const second=session.render(graph,'o');await assert.rejects(first,(error)=>error.name==='AbortError');await second;assert.equal(session.stats().cancelled,1);assert.equal(session.stats().completed,1);
});

test('explicit cancel aborts active output and stats remain inspectable',async()=>{
  const session=new CompositionDeliverySession({createManifest:()=>({settings:{}}),createFrameRenderer:()=>({}),audioPlanForOutput:()=>({sources:[]}),renderExport:({signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))});
  const task=session.render(graph,'o');await new Promise((resolve)=>setTimeout(resolve,0));assert.equal(session.stats().active,1);assert.equal(session.cancel('o'),true);await assert.rejects(task,(error)=>error.name==='AbortError');assert.equal(session.stats().active,0);
});
