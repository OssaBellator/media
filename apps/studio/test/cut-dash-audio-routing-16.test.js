import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const runtime=await readFile(new URL('../cut-playback-runtime.js',import.meta.url),'utf8');
const composition=await readFile(new URL('../composition-playback-engine.js',import.meta.url),'utf8');
test('normal Cut runtime wires DASH AudioData to BrowserLiveAudioScheduler',()=>{assert.match(runtime,/BrowserLiveAudioScheduler/);assert.match(runtime,/ownedDashAudio=dashAudioScheduler\?\?new BrowserLiveAudioScheduler\(dashAudioOptions\)/);assert.match(runtime,/audioOutput:ownedDashAudio/);assert.match(runtime,/dashAudioScheduler:ownedDashAudio/);});
test('composition close delegates to frame-provider close for adaptive audio cleanup',()=>{assert.match(composition,/typeof this\.frameProvider\?\.close==='function'/);assert.match(composition,/this\.frameProvider\.close\(\)/);assert.match(composition,/else this\.frameProvider\?\.clear\?\.\(\)/);});
