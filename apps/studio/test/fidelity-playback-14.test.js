import test from 'node:test';
import assert from 'node:assert/strict';
import {FidelityPlaybackEngine} from '../fidelity-playback.js';

test('aborted renders are tracked as cancelled without poisoning fidelity measurements',async()=>{
  const abort=new Error('cancelled');abort.name='AbortError';
  const engine=new FidelityPlaybackEngine({evaluate:()=>({compositionId:'c'}),render:async()=>{throw abort;}});
  await assert.rejects(()=>engine.present({nodes:{c:{props:{fps:30}}}},0),{name:'AbortError'});
  const stats=engine.stats();
  assert.equal(stats.cancelled,1);
  assert.equal(stats.failed,0);
  assert.equal(stats.fidelity.frames,0);
});

test('failed renders are not counted as presented frames',async()=>{
  const engine=new FidelityPlaybackEngine({evaluate:()=>({compositionId:'c'}),render:async()=>{throw new Error('gpu failed');}});
  await assert.rejects(()=>engine.present({nodes:{c:{props:{fps:30}}}},0),/gpu failed/);
  const stats=engine.stats();
  assert.equal(stats.failed,1);
  assert.equal(stats.presented,0);
  assert.equal(stats.fidelity.frames,0);
});
