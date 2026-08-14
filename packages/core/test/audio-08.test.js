import assert from 'node:assert/strict';
import test from 'node:test';
import { automationValueAt, applyGainAutomation, applyPanAutomation, normalizeAutomationCurve } from '../src/audio-automation.js';
import { analyzeLoudness, defaultLoudnessChannelWeights, intersamplePeakEstimate, loudnessGainDb, loudnessSeries, normalizeLoudness } from '../src/loudness.js';
import { renderAutomatedMix, pcmBlocks } from '../src/offline-audio.js';

function pcm(channels, sampleRate=48000){return{sampleRate,length:channels[0].length,channels:channels.map((x)=>Float32Array.from(x))};}

test('audio automation normalizes duplicate times and interpolates easing modes', () => {
  const curve = normalizeAutomationCurve([{time:1,value:1},{time:0,value:0},{time:1,value:2,easing:'hold'}]);
  assert.deepEqual(curve, [{time:0,value:0,easing:'linear'},{time:1,value:2,easing:'hold'}]);
  assert.equal(automationValueAt([{time:0,value:0},{time:2,value:2}],1),1);
  assert.equal(automationValueAt([{time:0,value:3,easing:'hold'},{time:2,value:9}],1),3);
});

test('gain and pan automation apply in sample domain', () => {
  const mono = pcm([[1,1,1]], 2);
  applyGainAutomation(mono,[{time:0,value:-6},{time:1,value:-6}]);
  assert.ok(mono.channels[0][1] > .49 && mono.channels[0][1] < .51);
  const stereo = pcm([[1,1],[1,1]], 2);
  applyPanAutomation(stereo,[{time:0,value:-1},{time:1,value:-1}]);
  assert.ok(stereo.channels[0][0] > .99);
  assert.ok(Math.abs(stereo.channels[1][0]) < 1e-6);
});

test('automated mix converts source-in samples when source rate differs', () => {
  const source = pcm([[0,1,2,3,4,5,6,7]], 8);
  const plan = {sampleRate:4,startSample:0,sampleCount:2,sources:[{clipId:'c',assetId:'a',startSample:0,endSample:2,sourceInSample:2,playbackRate:1,gainDb:0,pan:0,fadeIn:0,fadeOut:0}]};
  const out = renderAutomatedMix(plan,new Map([['a',source]]),{channels:1});
  assert.equal(out.channels[0][0],4, 'sourceInSample 2 at 4k output maps to source sample 4 at 8k');
  assert.equal(out.channels[0][1],6);
});

test('automated mix supports clip and master gain curves', () => {
  const source = pcm([[1,1,1,1]],4);
  const plan={sampleRate:4,startSample:0,sampleCount:4,sources:[{clipId:'c',assetId:'a',startSample:0,endSample:4,sourceInSample:0,playbackRate:1,gainDb:0,pan:0,fadeIn:0,fadeOut:0}]};
  const out=renderAutomatedMix(plan,{a:source},{channels:1,clipAutomation:{c:{gainDb:[{time:0,value:0},{time:1,value:-6}]}},masterAutomation:{gainDb:[{time:0,value:-6},{time:1,value:-6}]}});
  assert.ok(out.channels[0][0] > .49 && out.channels[0][0] < .51);
  assert.ok(out.channels[0][3] < out.channels[0][0]);
  assert.deepEqual(pcmBlocks(out,{blockFrames:3}).map((b)=>b.length),[3,1]);
});

test('loudness analysis returns gated integrated loudness and peak estimates', () => {
  const rate=48000,length=rate*2,signal=new Float32Array(length);
  for(let i=0;i<length;i++)signal[i]=0.1*Math.sin((2*Math.PI*1000*i)/rate);
  const result=analyzeLoudness(pcm([signal,signal],rate));
  assert.ok(Number.isFinite(result.integratedLufs));
  assert.ok(result.integratedLufs < 0);
  assert.ok(result.gatedBlocks > 0);
  assert.ok(result.truePeak >= result.samplePeak - 1e-6);
  assert.ok(Number.isFinite(loudnessGainDb(result,{targetLufs:-14})));
});

test('loudness normalization respects a true-peak ceiling estimate', () => {
  const rate=48000,length=rate,signal=new Float32Array(length).fill(.8);
  const result=normalizeLoudness(pcm([signal,signal],rate),{targetLufs:-8,maxTruePeakDbfs:-3});
  assert.ok(result.after.truePeakDbfs <= -2.99);
  assert.ok(intersamplePeakEstimate(result.buffer) <= .7085);
});

import { setClipAudioAutomationOperations, setOutputAudioAutomationOperations } from '../src/audio-automation.js';
test('audio automation emits graph operations for clips and outputs', () => {
  const graph={nodes:{t:{id:'t',kind:'track',name:'Audio',props:{mediaKind:'audio',locked:false}},c:{id:'c',kind:'clip',props:{trackId:'t'}},o:{id:'o',kind:'output',props:{}}}};
  const clipOp=setClipAudioAutomationOperations(graph,'c','pan',[{time:0,value:-2},{time:1,value:2}])[0];
  assert.deepEqual(clipOp.patch.props.audioAutomation.pan.map((p)=>p.value),[-1,1]);
  const outputOp=setOutputAudioAutomationOperations(graph,'o','gainDb',[{time:0,value:30}])[0];
  assert.equal(outputOp.patch.props.audioAutomation.gainDb[0].value,24);
  graph.nodes.t.props.locked=true;assert.throws(()=>setClipAudioAutomationOperations(graph,'c','gainDb',[]),/locked/);
});


test('loudness defaults apply BS.1770 surround/LFE channel weighting', () => {
  assert.deepEqual(defaultLoudnessChannelWeights(6),[1,1,1,0,1.41,1.41]);
  assert.equal(loudnessSeries(pcm([[0,0,0,0]],4),{windowSeconds:.5,stepSeconds:.25}).length,4);
});

test('windowed-sinc intersample estimate can detect reconstructed overshoot', () => {
  const signal=Float32Array.from([0.7,-0.7,0.7,-0.7,0.7,-0.7,0.7,-0.7]);
  const peak=intersamplePeakEstimate(pcm([signal],48000),4,{taps:12});
  assert.ok(peak>=0.7);
});
