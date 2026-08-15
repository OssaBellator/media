import test from 'node:test';
import assert from 'node:assert/strict';
import {createMediaProject,primaryComposition} from '../src/project.js';
import {evaluateComposition} from '../src/evaluation.js';

test('new compositions keep motion blur explicit and disabled by default',()=>{
  const graph=createMediaProject('test'),composition=primaryComposition(graph);
  assert.equal(composition.props.motionBlurEnabled,false);
  assert.equal(composition.props.shutterAngle,180);
  const plan=evaluateComposition(graph,{time:1});
  assert.equal(plan.fps,30);
  assert.deepEqual(plan.motionBlur,{enabled:false,shutterAngle:180,phase:'centered',weightCurve:'box'});
});

test('evaluation carries normalized explicit shutter policy',()=>{
  const graph=createMediaProject('test'),composition=primaryComposition(graph);
  graph.nodes[composition.id]={...composition,props:{...composition.props,fps:24,motionBlurEnabled:true,shutterAngle:270,shutterPhase:'trailing',motionBlurWeightCurve:'triangle'}};
  const plan=evaluateComposition(graph,{time:2});
  assert.equal(plan.fps,24);
  assert.equal(plan.frame,48);
  assert.deepEqual(plan.motionBlur,{enabled:true,shutterAngle:270,phase:'trailing',weightCurve:'triangle'});
});
