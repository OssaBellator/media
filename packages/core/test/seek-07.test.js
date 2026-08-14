import assert from 'node:assert/strict';
import test from 'node:test';
import { createSeekIndex, decodeWindowFromSeekIndex } from '../src/seek-index.js';
test('decode window starts on keyframe without including a chunk ending exactly at the keyframe',()=>{const chunks=[{trackId:'v',type:'key',timestamp:0,duration:1_000_000,sequence:0},{trackId:'v',type:'delta',timestamp:1_000_000,duration:1_000_000,sequence:1},{trackId:'v',type:'key',timestamp:2_000_000,duration:1_000_000,sequence:2},{trackId:'v',type:'delta',timestamp:3_000_000,duration:1_000_000,sequence:3}];const window=decodeWindowFromSeekIndex(createSeekIndex(chunks),'v',{time:3,ahead:1,behind:.25});assert.equal(window.start,2);assert.equal(window.chunks[0].timestamp,2_000_000);});
