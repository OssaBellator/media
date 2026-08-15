import assert from 'node:assert/strict';
import test from 'node:test';
import { createGraph } from '../src/graph.js';
import {
  MAX_PLANNER_OPERATIONS,
  MAX_PLANNER_SUMMARY_CHARS,
  assertPlannerResult,
  createHttpPlannerProvider,
  planWithProvider,
} from '../src/providers.js';

test('planner result bounds summary operation count and canonical bytes', () => {
  assert.throws(() => assertPlannerResult({ summary: 'x'.repeat(MAX_PLANNER_SUMMARY_CHARS + 1), operations: [] }), /summary exceeds/);
  const operation = { type: 'node.remove', nodeId: 'n' };
  assert.throws(() => assertPlannerResult({ summary: 'too many', operations: Array.from({ length: MAX_PLANNER_OPERATIONS + 1 }, () => operation) }), /exceeds 2048 operations/);
  assert.throws(() => assertPlannerResult({ summary: 'large', operations: [{ type: 'node.update', nodeId: 'n', patch: { props: { text: 'x'.repeat(400) } } }] }, { maxResultBytes: 256 }), /exceeds 256 bytes/);
});

test('planner result is normalized to the validated public contract', () => {
  const result = assertPlannerResult({ summary: 'ok', operations: [], hidden: 'do not retain' });
  assert.deepEqual(result, { summary: 'ok', operations: [] });
});

test('HTTP planner rejects declared oversized responses before consuming them', async () => {
  let consumed = false;
  const provider = createHttpPlannerProvider({ endpoint: 'https://planner.test', maxResponseBytes: 256, fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => '999' }, json: async () => { consumed = true; return { summary: 'x', operations: [] }; } }) });
  await assert.rejects(() => planWithProvider(provider, createGraph(), 'edit'), /exceeds 256 bytes/);
  assert.equal(consumed, false);
});

test('HTTP planner bounds streamed response bodies', async () => {
  const payload = JSON.stringify({ summary: 'x'.repeat(500), operations: [] });
  const provider = createHttpPlannerProvider({ endpoint: 'https://planner.test', maxResponseBytes: 256, fetchImpl: async () => new Response(payload, { status: 200 }) });
  await assert.rejects(() => planWithProvider(provider, createGraph(), 'edit'), /exceeds 256 bytes/);
});

test('HTTP planner bounds request snapshots before network submission', async () => {
  const graph = createGraph();
  graph.nodes[graph.projectId].props.note = 'x'.repeat(1000);
  let called = false;
  const provider = createHttpPlannerProvider({ endpoint: 'https://planner.test', maxRequestBytes: 256, fetchImpl: async () => { called = true; return new Response('{"summary":"ok","operations":[]}'); } });
  await assert.rejects(() => planWithProvider(provider, graph, 'edit'), /request exceeds 256 bytes/);
  assert.equal(called, false);
});
