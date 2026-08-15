import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedAgentOperationIndexes } from '../agent-review-panel.js';

test('selectedAgentOperationIndexes returns only checked safe indexes', () => {
  const root = {
    querySelectorAll: () => [
      { checked: true, dataset: { agentOperation: '0' } },
      { checked: false, dataset: { agentOperation: '1' } },
      { checked: true, dataset: { agentOperation: '3' } },
      { checked: true, dataset: { agentOperation: '-1' } },
      { checked: true, dataset: { agentOperation: 'nope' } },
    ],
  };
  assert.deepEqual(selectedAgentOperationIndexes(root), [0, 3]);
});
