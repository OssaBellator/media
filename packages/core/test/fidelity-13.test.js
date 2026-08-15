import test from 'node:test';import assert from 'node:assert/strict';
import {FidelityController,resolveCompositionFps} from '../src/fidelity-scheduler.js';
test('FPS resolves from evaluated compositionId even without node kind',()=>{const graph={nodes:{comp:{id:'comp',props:{fps:60}}}},evaluated={compositionId:'comp'};assert.equal(resolveCompositionFps(graph,evaluated),60);});
test('scrub fidelity always uses one sample',()=>{const c=new FidelityController();assert.deepEqual(c.plan({mode:'scrub',fps:60}).temporalSamples,1);});
test('export fidelity preserves requested quality',()=>{const c=new FidelityController();const p=c.plan({mode:'export',fps:24,requestedTemporalSamples:12,requestedVectorSupersample:4});assert.equal(p.temporalSamples,12);assert.equal(p.vectorSupersample,4);});
test('playback fidelity sheds quality when render time exceeds budget',()=>{const c=new FidelityController({maxTemporalSamples:8,maxVectorSupersample:4});c.record({durationMs:40});const p=c.plan({mode:'playback',fps:60,requestedTemporalSamples:8,requestedVectorSupersample:4});assert.ok(p.temporalSamples<8);assert.ok(p.vectorSupersample<4);});
