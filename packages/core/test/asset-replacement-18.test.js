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
  } };
}

test('resolves every clip/layer consumer deterministically', () => {
  assert.deepEqual(assetReplacementConsumers(graph(),'old').map((node)=>node.id), ['c1','c2','l1']);
  const operations=createAssetReplacementOperations(graph(),{sourceAssetId:'old',replacementAssetId:'next'});
  assert.deepEqual(operations.map((operation)=>operation.nodeId),['c1','c2','l1']);
  assert.ok(operations.every((operation)=>operation.patch.props.assetId==='next'));
});

test('supports a validated consumer subset', () => {
  const resolved=resolveAssetReplacement(graph(),{sourceAssetId:'old',replacementAssetId:'next',consumerNodeIds:['l1','c1','c1']});
  assert.deepEqual(resolved.consumers.map((node)=>node.id),['c1','l1']);
  assert.throws(()=>resolveAssetReplacement(graph(),{sourceAssetId:'old',replacementAssetId:'next',consumerNodeIds:['other']}),/does not reference source/);
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
