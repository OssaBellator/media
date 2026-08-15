import test from 'node:test';
import assert from 'node:assert/strict';
import { synchronizeHistoryReference } from '../agent-review-bridge.js';

test('synchronizeHistoryReference preserves the Studio-owned history identity', () => {
  const previous = { present: { id: 'before' }, past: [], future: [] };
  const next = { present: { id: 'after' }, past: [{ label: 'edit' }], future: [] };
  const session = { history: next };
  const result = synchronizeHistoryReference(session, previous, { history: next, graph: next.present, entry: { sequence: 1 } });
  assert.equal(session.history, previous);
  assert.equal(result.history, previous);
  assert.equal(result.graph, previous.present);
  assert.equal(previous.present.id, 'after');
  assert.equal(previous.past.length, 1);
});
