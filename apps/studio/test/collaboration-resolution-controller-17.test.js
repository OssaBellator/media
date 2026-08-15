import test from 'node:test';
import assert from 'node:assert/strict';
import { CollaborationResolutionSession } from '../collaboration-resolution-session.js';
import { CollaborationResolutionController } from '../collaboration-resolution-controller.js';

function model() {
  const remote = { sequence: 3, transactionId: 'remote', label: 'Remote', operationIndex: 0, operation: { type: 'node.update', summary: 'Update Node · props:title' } };
  return { schema: 'media.collaboration-resolution.v1', requestId: 'controller', status: 'conflict', head: { sequence: 4, checksum: 'head', transactionId: 'local' }, actor: { id: 'alice', keyId: 'k1' }, rows: [{ id: '4:0|3:0', local: { sequence: 4, transactionId: 'local', label: 'Local', operationIndex: 0, operation: { type: 'node.update', summary: 'Update Node · props:title' } }, remote, resources: [] }], conflictsTruncated: 0, complete: true, requiresRefresh: true, requiresResign: true, allowsAutomaticMerge: false };
}
class Container {
  constructor() { this.innerHTML = ''; this.listeners = new Map(); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type, listener) { if (this.listeners.get(type) === listener) this.listeners.delete(type); }
  click(target) { this.listeners.get('click')?.({ target }); }
}
function control(dataset, selector, { disabled = false } = {}) { return { dataset, disabled, closest(value) { return value === selector ? this : null; } }; }

test('controller mounts session HTML and installs one delegated click listener', () => {
  const container = new Container(), session = new CollaborationResolutionSession({ model: model() }), controller = new CollaborationResolutionController({ container, session });
  const html = controller.mount();
  assert.match(html, /COLLABORATION CONFLICT/);
  assert.equal(container.listeners.has('click'), true);
  assert.equal(controller.snapshot().mounted, true);
  controller.mount();
  assert.equal(container.listeners.size, 1);
});

test('controller applies a delegated explicit decision and rerenders selected state', async () => {
  const container = new Container(), session = new CollaborationResolutionSession({ model: model() }), controller = new CollaborationResolutionController({ container, session });
  controller.mount();
  const groupId = session.snapshot().draft.groups[0].id;
  const result = await controller.handleClick(control({ resolutionGroupId: groupId, collaborationDecision: 'keep-local' }, '[data-collaboration-decision]'));
  assert.equal(result.type, 'decision');
  assert.equal(session.snapshot().draft.groups[0].decision, 'keep-local');
  assert.match(container.innerHTML, /data-collaboration-decision="keep-local"[^>]*aria-pressed="true"/);
});

test('controller finalization emits only the session payload-free intent', async () => {
  const intents = [], container = new Container(), session = new CollaborationResolutionSession({ model: model(), onFinalize: async (intent) => intents.push(intent) }), controller = new CollaborationResolutionController({ container, session });
  controller.mount();
  const groupId = session.snapshot().draft.groups[0].id;
  await controller.handleClick(control({ resolutionGroupId: groupId, collaborationDecision: 'manual' }, '[data-collaboration-decision]'));
  const result = await controller.handleClick(control({}, '[data-collaboration-resolution-finalize]'));
  assert.equal(result.type, 'finalized');
  assert.equal(intents.length, 1);
  assert.deepEqual(result.intent, intents[0]);
  assert.equal(JSON.stringify(result.intent).includes('props:title'), false);
});

test('disabled finalization control never calls session finalization', async () => {
  let calls = 0;
  const container = new Container(), session = new CollaborationResolutionSession({ model: model(), onFinalize: async () => { calls++; } }), controller = new CollaborationResolutionController({ container, session });
  controller.mount();
  const result = await controller.handleClick(control({}, '[data-collaboration-resolution-finalize]', { disabled: true }));
  assert.equal(result.type, 'blocked');
  assert.equal(calls, 0);
});

test('controller serializes rapid decisions before finalization', async () => {
  const intents = [], container = new Container(), session = new CollaborationResolutionSession({ model: model(), onFinalize: async (intent) => intents.push(intent) }), controller = new CollaborationResolutionController({ container, session });
  controller.mount();
  const groupId = session.snapshot().draft.groups[0].id;
  const decision = controller.handleClick(control({ resolutionGroupId: groupId, collaborationDecision: 'reapply-remote' }, '[data-collaboration-decision]'));
  const finalize = controller.handleClick(control({}, '[data-collaboration-resolution-finalize]'));
  await decision;
  const result = await finalize;
  assert.equal(result.type, 'finalized');
  assert.equal(result.intent.decisions[0].choice, 'reapply-remote');
});

test('controller unmount removes listener and blocks further direct actions', async () => {
  const container = new Container(), session = new CollaborationResolutionSession({ model: model() }), controller = new CollaborationResolutionController({ container, session });
  controller.mount();
  controller.unmount();
  assert.equal(container.listeners.has('click'), false);
  assert.equal(controller.snapshot().mounted, false);
  await assert.rejects(() => controller.handleClick({ closest() { return null; } }), /not mounted/);
});
