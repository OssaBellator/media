import assert from 'node:assert/strict';
import test from 'node:test';
import { createGraph } from '../src/graph.js';
import {
  MAX_HTTP_PLANNER_REQUEST_BYTES,
  MAX_HTTP_PLANNER_RESPONSE_BYTES,
  MAX_HTTP_PLANNER_TIMEOUT_MS,
  MAX_PLANNER_OPERATIONS,
  MAX_PLANNER_RESULT_BYTES,
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


test('HTTP planner factory rejects accessor-bearing and coercive config without executing it', () => {
  let endpointGetterCalls = 0;
  const config = {};
  Object.defineProperty(config, 'endpoint', { enumerable: true, get() { endpointGetterCalls += 1; return 'https://planner.test'; } });
  assert.throws(() => createHttpPlannerProvider(config), /config must contain enumerable data fields only/);
  assert.equal(endpointGetterCalls, 0);

  let endpointCoercions = 0;
  const endpoint = { toString() { endpointCoercions += 1; return 'https://planner.test'; } };
  assert.throws(() => createHttpPlannerProvider({ endpoint }), /valid endpoint URL/);
  assert.equal(endpointCoercions, 0);

  let headerGetterCalls = 0;
  const headers = {};
  Object.defineProperty(headers, 'authorization', { enumerable: true, get() { headerGetterCalls += 1; return 'secret'; } });
  assert.throws(() => createHttpPlannerProvider({ endpoint: 'https://planner.test', headers }), /headers must be JSON-safe/i);
  assert.equal(headerGetterCalls, 0);
  assert.throws(() => createHttpPlannerProvider({ endpoint: 'https://planner.test', timeoutMs: '1000' }), /timeoutMs must be an integer/);
  assert.throws(() => createHttpPlannerProvider({ endpoint: 'https://planner.test', hidden: true }), /Unsupported http planner config field: hidden/);
});

test('HTTP planner factory enforces absolute transport ceilings and snapshots headers', async () => {
  assert.throws(() => createHttpPlannerProvider({ endpoint: 'https://planner.test', maxRequestBytes: MAX_HTTP_PLANNER_REQUEST_BYTES + 1 }), /maxRequestBytes must be an integer/);
  assert.throws(() => createHttpPlannerProvider({ endpoint: 'https://planner.test', maxResponseBytes: MAX_HTTP_PLANNER_RESPONSE_BYTES + 1 }), /maxResponseBytes must be an integer/);
  assert.throws(() => createHttpPlannerProvider({ endpoint: 'https://planner.test', timeoutMs: MAX_HTTP_PLANNER_TIMEOUT_MS + 1 }), /timeoutMs must be an integer/);
  assert.throws(() => createHttpPlannerProvider({ endpoint: 'https://planner.test', headers: { authorization: 7 } }), /headers must be bounded string pairs/);

  const sourceHeaders = { authorization: 'one' };
  let seenHeaders = null;
  const provider = createHttpPlannerProvider({ endpoint: 'https://planner.test', headers: sourceHeaders, fetchImpl: async (_url, options) => { seenHeaders = options.headers; return new Response('{"summary":"ok","operations":[]}'); } });
  sourceHeaders.authorization = 'two';
  await planWithProvider(provider, createGraph(), 'edit');
  assert.equal(seenHeaders.authorization, 'one');
  assert.equal(seenHeaders['content-type'], 'application/json');
});


test('planner result limit options are strict bounded data before result validation', () => {
  let getterCalls = 0;
  const options = {};
  Object.defineProperty(options, 'maxResultBytes', { enumerable: true, get() { getterCalls += 1; return 256; } });
  assert.throws(() => assertPlannerResult({ summary: 'ok', operations: [] }, options), /config must contain enumerable data fields only/);
  assert.equal(getterCalls, 0);
  assert.throws(() => assertPlannerResult({ summary: 'ok', operations: [] }, { maxResultBytes: '256' }), /maxResultBytes must be an integer/);
  assert.throws(() => assertPlannerResult({ summary: 'ok', operations: [] }, { maxResultBytes: MAX_PLANNER_RESULT_BYTES + 1 }), /maxResultBytes must be an integer/);
  assert.throws(() => assertPlannerResult({ summary: 'ok', operations: [] }, { hidden: true }), /Unsupported planner result config field: hidden/);
});
