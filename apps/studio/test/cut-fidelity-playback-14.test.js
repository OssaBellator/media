import test from 'node:test';
import assert from 'node:assert/strict';
import {createCutFidelityPlayback} from '../cut-fidelity-playback.js';

test('cut fidelity adapter evaluates once and sends fidelity to presentEvaluated',async()=>{
  let evaluations=0,received=null;
  const compositionEngine={
    evaluate:(_graph,{compositionId,time})=>{evaluations++;return{compositionId:compositionId??'comp',time,visual:[{kind:'text'}]};},
    async presentEvaluated(graph,evaluated,container,options){received={graph,evaluated,container,options};return{backend:'fake'};},
  };
  const engine=createCutFidelityPlayback({compositionEngine});
  const graph={nodes:{comp:{props:{fps:60}}}},container={};
  const result=await engine.present(graph,1.5,{compositionId:'comp',mode:'scrub',container});
  assert.equal(evaluations,1);
  assert.equal(received.evaluated.time,1.5);
  assert.equal(received.container,container);
  assert.equal(received.options.fidelity.fps,60);
  assert.equal(received.options.fidelity.resolutionScale,.5);
  assert.equal(result.backend,'fake');
});
