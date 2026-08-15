import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceRangesForAudioPlan } from '../offline-audio-runtime.js';

test('audio source ranges include playback-rate expanded source duration',()=>{
  const plan={sampleRate:48000,sources:[{assetId:'a',sourceInSample:48000,startSample:0,endSample:96000,playbackRate:2},{assetId:'b',sourceInSample:0,startSample:0,endSample:48000,playbackRate:1}]};
  assert.deepEqual(sourceRangesForAudioPlan(plan,'a'),[{start:1,end:5}]);
});
