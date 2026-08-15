import test from 'node:test';
import assert from 'node:assert/strict';
import { assetReplacementConsumers, createAssetReplacementOperations, resolveAssetReplacement } from '../src/asset-replacement.js';

function graph() {
  return { nodes: {
    old: { id:'old', kind:'asset', props:{mediaKind:'image'} },
    next: { id:'next', kind:'asset', props:{mediaKind:'image'} },
    audio: { id:'audio', kind:'asset', props:{mediaKind:'audio'} },
    c2: { id:'c2', kind:'clip', props:{assetId:'old'} },
    c1: { id:'c1', kind:'clip', props:{assetId:'old'} },
    l1: { id:'l1', kind:'layer', props:{assetId:'old'} },
    other: { id:'other', kind:'clip', props:{assetId:'next'} },
  }, edges: {
    rc1:{id:'rc1',from:'c1',to:'old',type:'references',props:{}},
    rc2:{id:'rc2',from:'c2',to:'old',type:'references',props:{}},
    rl1:{id:'rl1',from:'l1',to:'old',type:'references',props:{}},
    ro:{id:'ro',from:'other',to:'next',type:'references',props:{}},
  } };
}

test('resolves every clip/layer consumer deterministically', () => {
  assert.deepEqual(assetReplacementConsumers(graph(),'old').map((node)=>node.id), ['c1','c2','l1']);
  const operations=createAssetReplacementOperations(graph(),{sourceAssetId:'old',replacementAssetId:'next'});
  assert.deepEqual(operations.filter((operation)=>operation.type==='node.update').map((operation)=>operation.nodeId),['c1','c2','l1']);
  assert.deepEqual(operations.filter((operation)=>operation.type==='edge.add').map((operation)=>operation.edge.to),['next','next','next']);
  assert.deepEqual(operations.filter((operation)=>operation.type==='edge.remove').map((operation)=>operation.edgeId),['rc1','rc2','rl1']);
});

test('supports a validated consumer subset', () => {
  const resolved=resolveAssetReplacement(graph(),{sourceAssetId:'old',replacementAssetId:'next',consumerNodeIds:['l1','c1','c1']});
  assert.deepEqual(resolved.consumers.map((node)=>node.id),['c1','l1']);
  assert.equal(resolved.references.c1.id,'rc1');
  assert.throws(()=>resolveAssetReplacement(graph(),{sourceAssetId:'old',replacementAssetId:'next',consumerNodeIds:['other']}),/does not reference source/);
});

test('rejects missing or duplicate canonical reference edges', () => {
  const missing=graph(); delete missing.edges.rc1;
  assert.throws(()=>resolveAssetReplacement(missing,{sourceAssetId:'old',replacementAssetId:'next'}),/exactly once/);
  const duplicate=graph(); duplicate.edges.rc1b={id:'rc1b',from:'c1',to:'old',type:'references',props:{}};
  assert.throws(()=>resolveAssetReplacement(duplicate,{sourceAssetId:'old',replacementAssetId:'next'}),/exactly once/);
});

test('rejects incompatible media and self replacement', () => {
  assert.throws(()=>resolveAssetReplacement(graph(),{sourceAssetId:'old',replacementAssetId:'audio'}),/media kind/);
  assert.throws(()=>resolveAssetReplacement(graph(),{sourceAssetId:'old',replacementAssetId:'old'}),/must differ/);
});

test('treats music and audio as one replacement family', () => {
  const value=graph();
  value.nodes.old.props.mediaKind='music';
  value.nodes.next.props.mediaKind='audio';
  assert.doesNotThrow(()=>resolveAssetReplacement(value,{sourceAssetId:'old',replacementAssetId:'next'}));
});
