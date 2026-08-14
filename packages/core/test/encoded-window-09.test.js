import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRangeSource } from '../src/range-source.js';
import { compactEncodedWindowFromSource } from '../src/encoded-window.js';

test('range-backed encoded compaction rewrites absolute chunk offsets', async () => {
  const source = new MemoryRangeSource(Uint8Array.from({ length: 64 }, (_, i) => i));
  const chunks = [
    { trackId:'v', sequence:0, offset:4, byteLength:3, timestamp:0 },
    { trackId:'v', sequence:1, offset:20, byteLength:4, timestamp:33333 },
  ];
  const compact = await compactEncodedWindowFromSource(source, chunks, { mergeGap: 0 });
  assert.deepEqual([...compact.bytes], [4,5,6,20,21,22,23]);
  assert.equal(compact.chunks[0].offset, 0);
  assert.equal(compact.chunks[1].offset, 3);
  assert.equal(source.bytesRead, 7);
});

test('nearby encoded ranges can share an underlying source read', async () => {
  const source = new MemoryRangeSource(Uint8Array.from({ length: 64 }, (_, i) => i));
  const chunks = [{ offset:4,byteLength:2 },{ offset:8,byteLength:2 }];
  await compactEncodedWindowFromSource(source,chunks,{mergeGap:2});
  assert.equal(source.reads,1);
  assert.equal(source.bytesRead,6);
});
