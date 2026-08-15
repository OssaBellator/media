import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentProposalSession } from '../agent-proposal-session.js';
import { renderAgentReviewPanel } from '../agent-review-panel.js';

function sessionWith(plan) {
  const session = new AgentProposalSession({ provider: { plan: async () => plan }, getGraph: () => ({ projectId: 'p' }), commit: async () => ({}) });
  session.pending = plan;
  return session;
}

test('proposal session rejects partial selection for atomic-review plans', () => {
  const plan = { id: 'p1', operations: [{ type: 'a' }, { type: 'b' }, { type: 'c' }], metadata: { review: { atomic: true } }, summary: '', intent: '', revision: 1, provider: {} };
  const session = sessionWith(plan);
  assert.throws(() => session.select([0, 2]), /atomic review/);
  assert.throws(() => session.select([0, 1, 1]), /atomic review/);
  assert.doesNotThrow(() => session.select([2, 0, 1]));
  assert.equal(session.snapshot().plan, plan);
  const restylePlan = { ...plan, id: 'p2', metadata: { creativeObjectRestyle: { atomic: true } } };
  const restyleSession = sessionWith(restylePlan);
  assert.throws(() => restyleSession.select([0, 1]), /atomic review/);
  assert.doesNotThrow(() => restyleSession.select([0, 1, 2]));
});

test('review panel disables operation toggles for atomic proposals', () => {
  let markup = '';
  const form = { insertAdjacentHTML(position, value) { markup = value; } };
  const root = {
    querySelector(selector) {
      if (selector === '#agent-form') return form;
      if (selector === '#agent-form button[type="submit"]') return { textContent: '' };
      return null;
    },
  };
  renderAgentReviewPanel(root, {
    status: 'pending',
    plan: { metadata: { creativeObjectRestyle: { atomic: true } } },
    review: { summary: 'Atomic restyle', intent: 'restyle', provider: { label: 'Router' }, revision: 1, operations: [{ index: 0, type: 'node.add', summary: 'Add generated asset', changes: [] }] },
  });
  assert.match(markup, /checked disabled/);
  assert.match(markup, /proposal is atomic/i);
  assert.match(markup, />Apply all</);
});
