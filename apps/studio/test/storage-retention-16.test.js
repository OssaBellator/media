import test from 'node:test';
import assert from 'node:assert/strict';
import { planAssetGarbageCollection } from '../storage.js';

test('asset garbage collection retention protects undo and redo sources', () => {
  const now = Date.parse('2026-08-15T00:00:00Z');
  const records = [
    { id: 'undo-id', hash: 'x', size: 8, savedAt: '2020-01-01T00:00:00Z' },
    { id: 'hash-alias', hash: 'redo-hash', size: 9, savedAt: '2020-01-01T00:00:00Z' },
    { id: 'old', hash: 'old', size: 10, savedAt: '2020-01-01T00:00:00Z' },
  ];
  const plan = planAssetGarbageCollection({ nodes: {} }, records, {
    now,
    olderThanMs: 1000,
    retainAssetIds: ['undo-id'],
    retainAssetHashes: ['redo-hash'],
  });
  assert.deepEqual(plan.candidates.map((item) => item.id), ['old']);
  assert.equal(plan.retained.find((item) => item.id === 'undo-id').reason, 'referenced-id');
  assert.equal(plan.retained.find((item) => item.id === 'hash-alias').reason, 'referenced-hash');
});
