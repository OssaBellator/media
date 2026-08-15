import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMask } from '../src/compositing.js';
import { compileGpuRenderGraph } from '../src/gpu-render-graph.js';

test('vector masks normalize as first-class mask sources',()=>{
  const mask=normalizeMask({paths:[[[0,0],[10,0],[10,10],[0,10]]],fillRule:'nonzero',opacity:.7,feather:2});
  assert.equal(mask.type,'vector');
  assert.equal(mask.assetId,null);
  assert.equal(mask.paths.length,1);
  assert.equal(mask.fillRule,'nonzero');
  assert.equal(mask.opacity,.7);
});

test('asset masks stay backward compatible',()=>{
  const mask=normalizeMask({assetId:'asset-mask',mode:'luma',invert:true});
  assert.equal(mask.type,'asset');
  assert.equal(mask.assetId,'asset-mask');
  assert.equal(mask.mode,'luma');
  assert.equal(mask.invert,true);
});

test('vector masks reject luma semantics',()=>{
  assert.throws(()=>normalizeMask({paths:[[[0,0],[1,0],[1,1]]],mode:'luma'}),/alpha mode only/);
});

test('GPU graph emits vector mask nodes without fake asset ids',()=>{
  const graph=compileGpuRenderGraph({visual:[{kind:'clip',assetId:'source',effects:[],mask:{paths:[[[0,0],[10,0],[10,10]]],mode:'alpha'}}]});
  assert.equal(graph.supported,true);
  const mask=graph.nodes.find((node)=>node.kind==='mask-vector');
  assert.ok(mask);
  assert.equal(mask.assetId,undefined);
  assert.equal(mask.paths.length,1);
});
