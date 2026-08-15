import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { creativeObjectRestyleCapabilities } from '../creative-object-restyle-bridge.js';
import { creativeObjectOptions, creativeObjectRestylePanelMarkup, MAX_RESTYLE_OBJECT_OPTIONS } from '../creative-object-restyle-panel.js';
import { commitStudioOperations, registerStudioCommitProvider } from '../studio-services.js';

function graphFixture() {
  return {
    projectId: 'project-1',
    nodes: {
      'project-1': { id: 'project-1', kind: 'project', name: 'Project' },
      'object-b': { id: 'object-b', kind: 'creative-object', name: 'Zulu <Object>' },
      'object-a': { id: 'object-a', kind: 'creative-object', name: 'Alpha & Object' },
      img: { id: 'img', kind: 'asset', props: { mediaKind: 'image' } },
      vid: { id: 'vid', kind: 'asset', props: { mediaKind: 'video' } },
    },
  };
}

const resolveRepresentations = () => [{ assetId: 'img' }, { assetId: 'vid' }];
const operationForAsset = (asset) => asset.props.mediaKind === 'image' ? 'edit-image' : 'edit-video';

test('restyle capability requires every representation modality without invoking a model', () => {
  const graph = graphFixture();
  const partial = { execute() { throw new Error('must not invoke'); }, list(operation) { return operation === 'edit-image' ? [{ id: 'image' }] : []; } };
  const partialState = creativeObjectRestyleCapabilities(graph, 'object-a', partial, { resolveRepresentations, operationForAsset });
  assert.equal(partialState.available, false);
  assert.equal(partialState.representationCount, 2);
  assert.deepEqual(partialState.operations, ['edit-image', 'edit-video']);
  assert.deepEqual(partialState.missingOperations, ['edit-video']);

  const complete = { execute() { throw new Error('must not invoke'); }, list() { return [{ id: 'local-editor' }]; } };
  const completeState = creativeObjectRestyleCapabilities(graph, 'object-a', complete, { resolveRepresentations, operationForAsset });
  assert.equal(completeState.available, true);
  assert.equal(completeState.representationCount, 2);
});

test('restyle capability fails closed when Studio has no generated-media router', () => {
  const state = creativeObjectRestyleCapabilities(graphFixture(), 'object-a', null, { resolveRepresentations, operationForAsset });
  assert.equal(state.available, false);
  assert.match(state.reason, /No generated-media model router/);
});

test('restyle panel is bounded, escaped, and exposes one atomic Apply-all review', () => {
  const graph = graphFixture();
  for (let index = 0; index < MAX_RESTYLE_OBJECT_OPTIONS + 20; index += 1) {
    graph.nodes[`extra-${index}`] = { id: `extra-${index}`, kind: 'creative-object', name: `Extra ${String(index).padStart(3, '0')}` };
  }
  const options = creativeObjectOptions(graph);
  assert.equal(options.length, MAX_RESTYLE_OBJECT_OPTIONS);
  assert.equal(options[0].name, 'Alpha & Object');

  const markup = creativeObjectRestylePanelMarkup({
    graph,
    selectedObjectId: 'object-a',
    capability: { available: true, representationCount: 2, missingOperations: [] },
    state: {
      status: 'pending',
      plan: { intent: 'warm <editorial>', operations: [{ type: 'node.add' }] },
      review: { summary: 'Restyle <Alpha>', operations: [{ index: 0, summary: 'Add <generated> asset', type: 'node.add' }] },
      restyle: { representationCount: 2, assetWriteCount: 2, backendIds: ['local&image'] },
      error: null,
    },
  });
  assert.match(markup, /Alpha &amp; Object/);
  assert.match(markup, /warm &lt;editorial&gt;/);
  assert.match(markup, /Restyle &lt;Alpha&gt;/);
  assert.match(markup, /Add &lt;generated&gt; asset/);
  assert.match(markup, /local&amp;image/);
  assert.match(markup, /data-restyle-object disabled/);
  assert.match(markup, />Apply all</);
  assert.match(markup, /2 staged asset writes/);
  assert.doesNotMatch(markup, /data-agent-operation|type="checkbox"/);
});

test('Studio commit service forwards staged asset writes through the canonical journal boundary', async () => {
  const calls = [];
  const restore = registerStudioCommitProvider(async (...args) => { calls.push(args); return { history: { present: { projectId: 'p' } } }; });
  try {
    const operations = [{ type: 'node.add', node: { id: 'generated', kind: 'asset' } }];
    const metadata = { source: 'agent', agentPlan: { id: 'plan-1' } };
    const persistContext = { assetWrites: [{ assetId: 'generated', blob: { size: 3 } }] };
    await commitStudioOperations('  Atomic restyle  ', operations, metadata, { persistContext });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'Atomic restyle');
    assert.equal(calls[0][1], operations);
    assert.equal(calls[0][2], metadata);
    assert.equal(calls[0][3].persistContext, persistContext);
  } finally {
    restore();
  }
});

test('Studio installs restyle bridge and binds commit service to HistoryJournalSession edit', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const runtime = await readFile(new URL('../studio-runtime.js', import.meta.url), 'utf8');
  assert.match(app, /installStudioCreativeObjectRestyleBridge\(\)/);
  assert.match(runtime, /registerStudioCommitProvider\(async \(label, operations, metadata = \{\}, options = \{\}\) =>/);
  assert.match(runtime, /historyJournal\.edit\(label, operations, metadata, options\)/);
  assert.match(runtime, /history = result\.history/);
});
