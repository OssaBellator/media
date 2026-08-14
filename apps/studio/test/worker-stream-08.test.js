import assert from 'node:assert/strict';
import test from 'node:test';
import { collectTransferables } from '../kernel-transfer.js';

class FakeVideoFrame {}
class FakeAudioData {}
test('kernel progress messages can transfer streamed video/audio objects and compact buffers', () => {
  const frame=new FakeVideoFrame(),audio=new FakeAudioData(),buffer=new ArrayBuffer(8);
  const message={type:'progress',detail:{frame,audio,nested:[new Uint8Array(buffer),frame]}};
  const result=collectTransferables(message,{scope:{VideoFrame:FakeVideoFrame,AudioData:FakeAudioData}});
  assert.equal(result.length,3);assert.ok(result.includes(frame));assert.ok(result.includes(audio));assert.ok(result.includes(buffer));
});
