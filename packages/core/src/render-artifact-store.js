export class RenderArtifactStoreError extends Error {
  constructor(message, { code = 'ERR_RENDER_ARTIFACT_STORE', cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'RenderArtifactStoreError';
    this.code = code;
  }
}

function bytesToHex(bytes) { return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join(''); }
function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let text = '';
  for (const value of bytes) text += String.fromCharCode(value);
  return btoa(text);
}
function normalizeIntegrity(value) {
  const text = String(value ?? '').trim();
  if (/^[a-f0-9]{64}$/i.test(text)) return { kind: 'hex', value: text.toLowerCase() };
  if (/^sha256-[A-Za-z0-9+/=]+$/.test(text)) return { kind: 'sri', value: text.slice(7) };
  throw new RenderArtifactStoreError('Render artifact integrity must be SHA-256 hex or SRI', { code: 'ERR_RENDER_ARTIFACT_STORE_INTEGRITY' });
}
function maxBytesOf(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new RenderArtifactStoreError('Render artifact maxArtifactBytes must be a positive safe integer', { code: 'ERR_RENDER_ARTIFACT_STORE_CONFIG' });
  return parsed;
}
function directBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}
async function readStream(stream, limit) {
  const reader = stream.getReader(), parts = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const bytes = directBytes(value);
      if (!bytes) throw new RenderArtifactStoreError('Render artifact stream produced non-byte data', { code: 'ERR_RENDER_ARTIFACT_STORE_FORMAT' });
      total += bytes.byteLength;
      if (total > limit) {
        await reader.cancel('artifact too large').catch(() => {});
        return null;
      }
      parts.push(bytes);
    }
  } finally { reader.releaseLock?.(); }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.byteLength; }
  return out;
}
async function storedBytes(value, limit) {
  const payload = value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'bytes') ? value.bytes : value;
  const direct = directBytes(payload);
  if (direct) return direct.byteLength <= limit ? direct : null;
  if (typeof Blob !== 'undefined' && payload instanceof Blob) {
    if (payload.size > limit) return null;
    return new Uint8Array(await payload.arrayBuffer());
  }
  if (payload?.getReader && typeof payload.getReader === 'function') return readStream(payload, limit);
  throw new RenderArtifactStoreError('Render artifact reader must return bytes, Blob, ReadableStream, or {bytes}', { code: 'ERR_RENDER_ARTIFACT_STORE_FORMAT' });
}

export async function verifyStoredRenderArtifact({
  artifact,
  integrity,
  readArtifact,
  maxArtifactBytes = 256 * 1024 * 1024,
  subtle = globalThis.crypto?.subtle,
  job = null,
  chunk = null,
  actor = null,
} = {}) {
  if (typeof readArtifact !== 'function') throw new RenderArtifactStoreError('Render artifact readArtifact callback is required', { code: 'ERR_RENDER_ARTIFACT_STORE_CONFIG' });
  if (!subtle?.digest) throw new RenderArtifactStoreError('SHA-256 is unavailable for render artifact verification', { code: 'ERR_RENDER_ARTIFACT_STORE_CRYPTO' });
  const expected = normalizeIntegrity(integrity), limit = maxBytesOf(maxArtifactBytes);
  let stored;
  try { stored = await readArtifact({ artifact: structuredClone(artifact ?? {}), job, chunk, actor: actor == null ? null : structuredClone(actor) }); }
  catch (error) { throw new RenderArtifactStoreError('Render artifact storage read failed', { code: 'ERR_RENDER_ARTIFACT_STORE_READ', cause: error }); }
  if (stored == null) return { verified: false, byteLength: 0, integrity: null, sha256: null };
  const bytes = await storedBytes(stored, limit);
  if (!bytes) return { verified: false, byteLength: null, integrity: null, sha256: null, tooLarge: true };
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
  const sha256 = bytesToHex(digest), sriValue = bytesToBase64(digest), actual = expected.kind === 'hex' ? sha256 : sriValue;
  return { verified: actual === expected.value, byteLength: bytes.byteLength, integrity: `sha256-${sriValue}`, sha256, tooLarge: false };
}

export function createStoredRenderArtifactVerifier(options = {}) {
  if (typeof options.readArtifact !== 'function') throw new RenderArtifactStoreError('Render artifact readArtifact callback is required', { code: 'ERR_RENDER_ARTIFACT_STORE_CONFIG' });
  return async (context = {}) => (await verifyStoredRenderArtifact({ ...options, ...context })).verified;
}
