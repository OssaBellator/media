import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  RenderArtifactStoreError,
  createStoredRenderArtifactVerifier,
  verifyStoredRenderArtifact,
} from '../src/render-artifact-store.js';

const bytes = new TextEncoder().encode('artifact-bytes');
const hex = createHash('sha256').update(bytes).digest('hex');
const sri = `sha256-${createHash('sha256').update(bytes).digest('base64')}`;

test('stored artifact verifier accepts exact bytes for hex and SRI SHA-256 descriptors', async () => {
  const byHex = await verifyStoredRenderArtifact({ artifact: { key: 'a' }, integrity: hex, readArtifact: async () => bytes });
  assert.equal(byHex.verified, true);
  assert.equal(byHex.sha256, hex);
  assert.equal(byHex.integrity, sri);
  assert.equal(byHex.byteLength, bytes.byteLength);
  const bySri = await verifyStoredRenderArtifact({ artifact: { key: 'a' }, integrity: sri, readArtifact: async () => new Blob([bytes]) });
  assert.equal(bySri.verified, true);
});

test('stored artifact verifier returns false for missing, mismatched or oversized stored bytes', async () => {
  const missing = await verifyStoredRenderArtifact({ integrity: hex, readArtifact: async () => null });
  assert.equal(missing.verified, false);
  const mismatch = await verifyStoredRenderArtifact({ integrity: hex, readArtifact: async () => new TextEncoder().encode('wrong') });
  assert.equal(mismatch.verified, false);
  const oversized = await verifyStoredRenderArtifact({ integrity: hex, readArtifact: async () => bytes, maxArtifactBytes: 4 });
  assert.equal(oversized.verified, false);
  assert.equal(oversized.tooLarge, true);
});

test('stored artifact verifier reads bounded ReadableStream bytes exactly', async () => {
  const stream = new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, 3)); controller.enqueue(bytes.slice(3)); controller.close(); } });
  const result = await verifyStoredRenderArtifact({ integrity: sri, readArtifact: async () => stream });
  assert.equal(result.verified, true);
  assert.equal(result.byteLength, bytes.byteLength);
});

test('storage read failures are service errors rather than artifact mismatches', async () => {
  await assert.rejects(
    () => verifyStoredRenderArtifact({ integrity: hex, readArtifact: async () => { throw new Error('object store unavailable'); } }),
    (error) => error instanceof RenderArtifactStoreError && error.code === 'ERR_RENDER_ARTIFACT_STORE_READ' && error.cause?.message === 'object store unavailable',
  );
});

test('stored artifact verifier rejects invalid adapters and integrity formats', async () => {
  await assert.rejects(() => verifyStoredRenderArtifact({ integrity: 'md5-nope', readArtifact: async () => bytes }), (error) => error.code === 'ERR_RENDER_ARTIFACT_STORE_INTEGRITY');
  await assert.rejects(() => verifyStoredRenderArtifact({ integrity: hex, readArtifact: async () => ({ nope: true }) }), (error) => error.code === 'ERR_RENDER_ARTIFACT_STORE_FORMAT');
  assert.throws(() => createStoredRenderArtifactVerifier(), (error) => error.code === 'ERR_RENDER_ARTIFACT_STORE_CONFIG');
});

test('coordinator-compatible verifier forwards artifact context and returns only a boolean', async () => {
  const reads = [];
  const verify = createStoredRenderArtifactVerifier({ readArtifact: async (context) => { reads.push(context); return { bytes }; } });
  const ok = await verify({ artifact: { key: 'segment' }, integrity: hex, job: { id: 'job' }, chunk: { id: 'chunk' }, actor: { id: 'worker' } });
  assert.equal(ok, true);
  assert.equal(reads.length, 1);
  assert.equal(reads[0].artifact.key, 'segment');
  assert.equal(reads[0].actor.id, 'worker');
});
