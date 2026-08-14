import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRangeSource, PagedRangeSource, mergeByteRanges, readRanges } from '../src/range-source.js';

test('mergeByteRanges coalesces nearby ranges without exceeding max length', () => {
  const merged = mergeByteRanges([{ offset: 0, length: 4 }, { offset: 6, length: 2 }, { offset: 20, length: 5 }], { gap: 2, maxLength: 10 });
  assert.deepEqual(merged.map(({ offset, length }) => ({ offset, length })), [{ offset: 0, length: 8 }, { offset: 20, length: 5 }]);
});

test('readRanges preserves requested order while merging reads', async () => {
  const source = new MemoryRangeSource(Uint8Array.from({ length: 32 }, (_, i) => i));
  const parts = await readRanges(source, [{ offset: 10, length: 3 }, { offset: 0, length: 4 }, { offset: 4, length: 2 }], { mergeGap: 0 });
  assert.deepEqual([...parts[0]], [10, 11, 12]);
  assert.deepEqual([...parts[1]], [0, 1, 2, 3]);
  assert.deepEqual([...parts[2]], [4, 5]);
  assert.equal(source.reads, 2);
});

test('PagedRangeSource serves repeated reads from bounded page cache', async () => {
  const base = new MemoryRangeSource(Uint8Array.from({ length: 100 }, (_, i) => i));
  const source = new PagedRangeSource(base, { pageSize: 16, maxBytes: 32 });
  assert.deepEqual([...await source.read(10, 20)], Array.from({ length: 20 }, (_, i) => i + 10));
  const reads = base.reads;
  await source.read(12, 4);
  assert.equal(base.reads, reads);
  await source.read(64, 20);
  assert.ok(source.stats().cachedBytes <= 32);
  assert.ok(source.stats().hits >= 1);
});

test('range reads reject out-of-bounds requests', async () => {
  const source = new MemoryRangeSource(new Uint8Array(8));
  await assert.rejects(() => source.read(7, 2), /exceeds source size/);
});
