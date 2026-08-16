import assert from 'node:assert/strict';
import test from 'node:test';
import { createGraph } from '../src/graph.js';
import { applyOperations } from '../src/operations.js';
import { createCreativeObjectOperations } from '../src/creative-object.js';
import { ModelRouter } from '../src/model-router.js';
import {
  MAX_SEMANTIC_EMBEDDING_SCALARS,
  assertSemanticEmbeddingIndex,
  createSemanticEmbeddingIndex,
  embedSemanticQuery,
  searchSemanticEmbeddingIndex,
  searchSemanticHybrid,
  semanticEmbeddingCacheKey,
  semanticEmbeddingSourceFingerprint,
} from '../src/semantic-embedding.js';
import { MAX_SEMANTIC_QUERY_CHARS } from '../src/semantic-search.js';

function embedRouter(seen = []) {
  return new ModelRouter().register({ id: 'embedder', operations: ['embed'], invoke: async (_operation, input) => {
    seen.push(...input.texts);
    return { vectors: input.texts.map((text) => {
      const value = text.toLowerCase();
      return [Number(value.includes('maya')), Number(value.includes('product')), Number(value.includes('blue'))];
    }) };
  } });
}

test('semantic embedding index uses privacy-redacted semantic documents and excludes hidden objects', async () => {
  let graph = createGraph('Film');
  const full = createCreativeObjectOperations(graph, { name: 'Maya', objectType: 'person', semantics: { wardrobe: 'blue' } });
  graph = applyOperations(graph, full);
  const metadata = createCreativeObjectOperations(graph, { name: 'Product', objectType: 'product', semantics: { codename: 'secretword' }, permissions: { modelAccess: 'metadata' } });
  graph = applyOperations(graph, metadata);
  const hidden = createCreativeObjectOperations(graph, { name: 'Hidden person', objectType: 'person', tags: ['nightingale'], permissions: { modelAccess: 'none' } });
  graph = applyOperations(graph, hidden);
  const seen = [];
  const index = await createSemanticEmbeddingIndex(graph, embedRouter(seen), { kinds: ['object'] });
  assert.equal(index.documents.length, 2);
  assert.equal(index.documents.some((item) => item.id === hidden[0].node.id), false);
  assert.equal(seen.some((text) => text.includes('secretword')), false);
  assert.equal(seen.some((text) => text.includes('nightingale')), false);
});

test('embedding search and query routing rank cosine similarity deterministically', async () => {
  let graph = createGraph('Film');
  const maya = createCreativeObjectOperations(graph, { name: 'Maya', objectType: 'person', tags: ['blue'] });
  graph = applyOperations(graph, maya);
  const product = createCreativeObjectOperations(graph, { name: 'Product', objectType: 'product' });
  graph = applyOperations(graph, product);
  const seen = [];
  const router = embedRouter(seen);
  const index = await createSemanticEmbeddingIndex(graph, router, { kinds: ['object'] });
  assert.equal(searchSemanticEmbeddingIndex(index, [1, 0, 1])[0].id, maya[0].node.id);
  const beforeQuery = seen.length;
  let getterCalls = 0;
  const unsafePolicy = {};
  Object.defineProperty(unsafePolicy, 'allowedBackendIds', { enumerable: true, get() { getterCalls += 1; return ['embedder']; } });
  await assert.rejects(() => embedSemanticQuery(router, index, 'Maya blue', { policy: unsafePolicy }), /Model routing policy must be JSON-safe/);
  assert.equal(getterCalls, 0);
  assert.equal(seen.length, beforeQuery);
  await assert.rejects(() => embedSemanticQuery(router, index, 'Maya blue', { policy: { allowedBackendIds: [1] } }), /allowedBackendIds must contain non-empty string ids/);
  assert.equal(seen.length, beforeQuery);
  const queried = await embedSemanticQuery(router, index, 'Maya blue');
  assert.equal(queried[0].id, maya[0].node.id);
  assert.equal(queried[0].backendId, 'embedder');
});

test('embedding index rejects backend dimension drift and scalar-budget explosions', async () => {
  let graph = createGraph('Film');
  for (let i = 0; i < 3; i += 1) graph = applyOperations(graph, createCreativeObjectOperations(graph, { name: `Object ${i}`, objectType: 'thing' }));
  let call = 0;
  const drifting = new ModelRouter().register({ id: 'drift', operations: ['embed'], invoke: async (_operation, input) => ({ vectors: input.texts.map(() => (++call > 1 ? [1, 2] : [1, 2, 3])) }) });
  await assert.rejects(() => createSemanticEmbeddingIndex(graph, drifting, { kinds: ['object'], batchSize: 1 }), /do not match expected/);
  const wide = new ModelRouter().register({ id: 'wide', operations: ['embed'], invoke: async (_operation, input) => ({ vectors: input.texts.map(() => Array(100).fill(1)) }) });
  await assert.rejects(() => createSemanticEmbeddingIndex(graph, wide, { kinds: ['object'], maxScalars: 256 }), /exceeds 256 scalar/);
});

test('hybrid semantic search combines deterministic lexical and embedding ranks', async () => {
  let graph = createGraph('Film');
  const maya = createCreativeObjectOperations(graph, { name: 'Maya', objectType: 'person', tags: ['hero'] });
  graph = applyOperations(graph, maya);
  const product = createCreativeObjectOperations(graph, { name: 'Product', objectType: 'product', tags: ['hero'] });
  graph = applyOperations(graph, product);
  const index = await createSemanticEmbeddingIndex(graph, embedRouter(), { kinds: ['object'] });
  const hybrid = searchSemanticHybrid(graph, index, 'hero Maya', [1, 0, 0], { kinds: ['object'] });
  assert.equal(hybrid[0].id, maya[0].node.id);
});

test('embedding backend output rejects accessors without executing them', async () => {
  const graph = createGraph('Film');
  let rootGetterCalls = 0;
  const rootOutput = {};
  Object.defineProperty(rootOutput, 'vectors', { enumerable: true, get() { rootGetterCalls += 1; return [[1]]; } });
  const rootRouter = new ModelRouter().register({ id: 'root-getter', operations: ['embed'], invoke: async () => rootOutput });
  await assert.rejects(() => createSemanticEmbeddingIndex(graph, rootRouter, { maxDocuments: 1 }), /Embedding backend output.*enumerable data properties only/);
  assert.equal(rootGetterCalls, 0);

  let vectorGetterCalls = 0;
  const vector = [];
  Object.defineProperty(vector, '0', { enumerable: true, get() { vectorGetterCalls += 1; return 1; } });
  vector.length = 1;
  const vectorRouter = new ModelRouter().register({ id: 'vector-getter', operations: ['embed'], invoke: async () => ({ vectors: [vector] }) });
  await assert.rejects(() => createSemanticEmbeddingIndex(graph, vectorRouter, { maxDocuments: 1 }), /Embedding backend output arrays must be dense data arrays/);
  assert.equal(vectorGetterCalls, 0);
});

test('embedding backend vectors require finite numeric scalars and preserve typed-array support', async () => {
  const graph = createGraph('Film');
  const stringRouter = new ModelRouter().register({ id: 'strings', operations: ['embed'], invoke: async (_operation, input) => ({ vectors: input.texts.map(() => ['1', 0]) }) });
  await assert.rejects(() => createSemanticEmbeddingIndex(graph, stringRouter, { maxDocuments: 1 }), /Embedding vector values must be finite numbers/);

  const bigintRouter = new ModelRouter().register({ id: 'bigints', operations: ['embed'], invoke: async (_operation, input) => ({ vectors: input.texts.map(() => new BigInt64Array([1n, 2n])) }) });
  await assert.rejects(() => createSemanticEmbeddingIndex(graph, bigintRouter, { maxDocuments: 1 }), /Embedding vector values must be finite numbers/);

  const typedRouter = new ModelRouter().register({ id: 'typed', operations: ['embed'], invoke: async (_operation, input) => ({ vectors: input.texts.map(() => new Float32Array([1, 0.5])) }) });
  const index = await createSemanticEmbeddingIndex(graph, typedRouter, { maxDocuments: 1 });
  assert.deepEqual(index.documents[0].vector, [1, 0.5]);
});

test('embedding backend output rejects unknown fields and unsafe metadata before indexing', async () => {
  const graph = createGraph('Film');
  const unknown = new ModelRouter().register({ id: 'unknown', operations: ['embed'], invoke: async () => ({ vectors: [[1]], secret: 'hidden' }) });
  await assert.rejects(() => createSemanticEmbeddingIndex(graph, unknown, { maxDocuments: 1 }), /Unsupported embedding backend output field: secret/);

  let metadataGetterCalls = 0;
  const metadata = {};
  Object.defineProperty(metadata, 'secret', { enumerable: true, get() { metadataGetterCalls += 1; return 'hidden'; } });
  const unsafeMetadata = new ModelRouter().register({ id: 'metadata-getter', operations: ['embed'], invoke: async () => ({ vectors: [[1]], metadata }) });
  await assert.rejects(() => createSemanticEmbeddingIndex(graph, unsafeMetadata, { maxDocuments: 1 }), /Embedding backend output objects must contain enumerable data properties only/);
  assert.equal(metadataGetterCalls, 0);
});

test('semantic embedding creation rejects accessor and coercive options before backend invocation', async () => {
  const graph = createGraph('Film');
  let backendCalls = 0;
  const router = new ModelRouter().register({ id: 'embedder', operations: ['embed'], invoke: async (_operation, input) => { backendCalls += 1; return { vectors: input.texts.map(() => [1]) }; } });
  let getterCalls = 0;
  const options = {};
  Object.defineProperty(options, 'maxDocuments', { enumerable: true, get() { getterCalls += 1; return 1; } });
  await assert.rejects(() => createSemanticEmbeddingIndex(graph, router, options), /create options must contain enumerable data fields only/);
  assert.equal(getterCalls, 0);
  assert.equal(backendCalls, 0);
  await assert.rejects(() => createSemanticEmbeddingIndex(graph, router, { maxDocuments: '1' }), /maxDocuments must be an integer/);
  await assert.rejects(() => createSemanticEmbeddingIndex(graph, router, { batchSize: 257 }), /batchSize must be an integer between 1 and 256/);
  await assert.rejects(() => createSemanticEmbeddingIndex(graph, router, { maxScalars: MAX_SEMANTIC_EMBEDDING_SCALARS + 1 }), /maxScalars must be an integer/);
  assert.equal(backendCalls, 0);
});

test('semantic embedding captures router methods and rejects accessor or forged signal boundaries', async () => {
  const graph = createGraph('Film');
  let executeGetterCalls = 0;
  const executeGetterRouter = { list() { return []; } };
  Object.defineProperty(executeGetterRouter, 'execute', { enumerable: true, get() { executeGetterCalls += 1; return async () => ({ backendId: 'embedder', output: { vectors: [[1]] } }); } });
  await assert.rejects(() => createSemanticEmbeddingIndex(graph, executeGetterRouter), /router execute must be a data method/);
  assert.equal(executeGetterCalls, 0);

  let listGetterCalls = 0;
  const listGetterRouter = { execute: async () => ({ backendId: 'embedder', output: { vectors: [[1]] } }) };
  Object.defineProperty(listGetterRouter, 'list', { enumerable: true, get() { listGetterCalls += 1; return () => []; } });
  await assert.rejects(() => createSemanticEmbeddingIndex(graph, listGetterRouter), /router list must be a data method/);
  assert.equal(listGetterCalls, 0);

  let abortedGetterCalls = 0;
  let signalRouterCalls = 0;
  const forgedSignal = {};
  Object.defineProperty(forgedSignal, 'aborted', { enumerable: true, get() { abortedGetterCalls += 1; return false; } });
  const signalRouter = { execute: async () => { signalRouterCalls += 1; return { backendId: 'embedder', output: { vectors: [[1]] } }; } };
  await assert.rejects(() => createSemanticEmbeddingIndex(graph, signalRouter, { signal: forgedSignal }), /signal must be an AbortSignal/);
  assert.equal(abortedGetterCalls, 0);
  assert.equal(signalRouterCalls, 0);

  let multi = graph;
  multi = applyOperations(multi, createCreativeObjectOperations(multi, { name: 'One', objectType: 'thing' }));
  multi = applyOperations(multi, createCreativeObjectOperations(multi, { name: 'Two', objectType: 'thing' }));
  let stableCalls = 0;
  const stableRouter = {
    execute: async (_operation, input) => {
      stableCalls += 1;
      if (stableCalls === 1) stableRouter.execute = async () => { throw new Error('swapped execute must not run'); };
      return { backendId: 'stable', output: { vectors: input.texts.map(() => [1]) }, attempts: [] };
    },
  };
  const index = await createSemanticEmbeddingIndex(multi, stableRouter, { kinds: ['object'], batchSize: 1 });
  assert.equal(stableCalls, 2);
  assert.equal(index.backendId, 'stable');
});

test('semantic embedding normalizes routed envelopes and listed backend identities without executing getters', async () => {
  const graph = createGraph('Film');
  let outputGetterCalls = 0;
  const routed = { backendId: 'embedder', attempts: [] };
  Object.defineProperty(routed, 'output', { enumerable: true, get() { outputGetterCalls += 1; return { vectors: [[1]] }; } });
  await assert.rejects(() => createSemanticEmbeddingIndex(graph, { execute: async () => routed }, { maxDocuments: 1 }), /routed result must contain enumerable data fields only/);
  assert.equal(outputGetterCalls, 0);

  let idGetterCalls = 0;
  const listed = {};
  Object.defineProperty(listed, 'id', { enumerable: true, get() { idGetterCalls += 1; return 'embedder'; } });
  const listRouter = { execute: async () => { throw new Error('empty semantic scope must not execute'); }, list() { return [listed]; } };
  await assert.rejects(() => createSemanticEmbeddingIndex(graph, listRouter, { kinds: ['object'] }), /listed backend id must be an enumerable data property/);
  assert.equal(idGetterCalls, 0);
});

test('semantic embedding kinds and cache identities reject implicit coercion', () => {
  const graph = createGraph('Film');
  let coercions = 0;
  const forged = { toString() { coercions += 1; return 'project'; } };
  assert.throws(() => semanticEmbeddingSourceFingerprint(graph, { kinds: [forged] }), /Semantic embedding kind must be a non-empty string/);
  assert.equal(coercions, 0);

  let getterCalls = 0;
  const keyOptions = { sourceFingerprint: 'source', backendId: 'backend' };
  Object.defineProperty(keyOptions, 'projectId', { enumerable: true, get() { getterCalls += 1; return graph.projectId; } });
  assert.throws(() => semanticEmbeddingCacheKey(keyOptions), /cache key options must contain enumerable data fields only/);
  assert.equal(getterCalls, 0);
});

test('semantic embedding search and hybrid ranking reject coercive numeric options', async () => {
  const graph = createGraph('Film');
  const index = await createSemanticEmbeddingIndex(graph, embedRouter(), { maxDocuments: 1 });
  assert.throws(() => searchSemanticEmbeddingIndex(index, index.documents[0].vector, { limit: '1' }), /search limit must be an integer/);
  assert.throws(() => searchSemanticEmbeddingIndex(index, index.documents[0].vector, { minimumScore: '0' }), /minimumScore must be a finite number/);
  assert.throws(() => searchSemanticHybrid(graph, index, 'Film', index.documents[0].vector, { lexicalWeight: '1' }), /lexicalWeight must be a finite number/);
  assert.throws(() => searchSemanticHybrid(graph, index, 'Film', index.documents[0].vector, { embeddingWeight: -1 }), /embeddingWeight must be a finite number/);
});

test('semantic embedding query validates options and text before model routing', async () => {
  const graph = createGraph('Film');
  const index = await createSemanticEmbeddingIndex(graph, embedRouter(), { maxDocuments: 1 });
  let backendCalls = 0;
  const router = new ModelRouter().register({ id: index.backendId, operations: ['embed'], invoke: async () => { backendCalls += 1; return { vectors: [[1, 0, 0]] }; } });
  let coercions = 0;
  const forged = { toString() { coercions += 1; return 'Film'; } };
  await assert.rejects(() => embedSemanticQuery(router, index, forged), /query must be a string/);
  assert.equal(coercions, 0);
  await assert.rejects(() => embedSemanticQuery(router, index, 'x'.repeat(MAX_SEMANTIC_QUERY_CHARS + 1)), /query exceeds 4096 characters/);
  await assert.rejects(() => embedSemanticQuery(router, index, 'Film', { limit: '1' }), /query limit must be an integer/);
  assert.equal(backendCalls, 0);
});

test('semantic embedding index validation rejects accessors without executing them', async () => {
  const graph = createGraph('Film');
  const valid = await createSemanticEmbeddingIndex(graph, embedRouter(), { maxDocuments: 1 });

  let rootGetterCalls = 0;
  const root = { ...valid };
  Object.defineProperty(root, 'documents', { enumerable: true, get() { rootGetterCalls += 1; return valid.documents; } });
  assert.throws(() => assertSemanticEmbeddingIndex(root), /Semantic embedding index objects must contain enumerable data properties only/);
  assert.equal(rootGetterCalls, 0);

  let vectorGetterCalls = 0;
  const document = { ...valid.documents[0] };
  Object.defineProperty(document, 'vector', { enumerable: true, get() { vectorGetterCalls += 1; return valid.documents[0].vector; } });
  assert.throws(() => assertSemanticEmbeddingIndex({ ...valid, documents: [document] }), /Semantic embedding index objects must contain enumerable data properties only/);
  assert.equal(vectorGetterCalls, 0);
});

test('semantic embedding index validation returns an inert detached clone with strict fields', async () => {
  const graph = createGraph('Film');
  const index = await createSemanticEmbeddingIndex(graph, embedRouter(), { maxDocuments: 1 });
  const safe = assertSemanticEmbeddingIndex(index);
  assert.notEqual(safe, index);
  assert.notEqual(safe.documents, index.documents);
  assert.notEqual(safe.documents[0].vector, index.documents[0].vector);
  const original = safe.documents[0].vector[0];
  index.documents[0].vector[0] = original + 10;
  assert.equal(safe.documents[0].vector[0], original);
  assert.throws(() => assertSemanticEmbeddingIndex({ ...index, unexpected: true }), /Unsupported semantic embedding index field: unexpected/);
  assert.throws(() => assertSemanticEmbeddingIndex({ ...index, documents: [{ ...index.documents[0], unexpected: true }] }), /Unsupported semantic embedding document field: unexpected/);
  assert.throws(() => assertSemanticEmbeddingIndex({ ...index, routing: [{ backendId: index.backendId, count: 1, unexpected: true }] }), /Unsupported semantic embedding routing field: unexpected/);
});
