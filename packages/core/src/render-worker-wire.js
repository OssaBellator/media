import { canonicalOperationLogJson } from './operation-log.js';
import { RenderWorkerAuthError, validateRenderWorkerMessage } from './render-worker-auth.js';
import { TrustRegistryError } from './trust-registry.js';

export const RENDER_WORKER_WIRE_SCHEMA = 'media.render-worker-wire.v1';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
export class RenderWorkerWireError extends Error {
  constructor(message, { code = 'ERR_RENDER_WORKER_WIRE', statusCode = 400, requestId = null } = {}) {
    super(message);
    this.name = 'RenderWorkerWireError';
    this.code = code;
    this.statusCode = statusCode;
    this.requestId = requestId;
  }
}
function clone(value) { return JSON.parse(canonicalOperationLogJson(value)); }
function token(value, label, { maxLength = 128, requestId = null } = {}) {
  if (typeof value !== 'string' || !value || value.length > maxLength) throw new RenderWorkerWireError(`${label} is invalid`, { code: 'ERR_RENDER_WORKER_WIRE_FORMAT', requestId });
  return value;
}
function bytesOf(value) {
  if (typeof value === 'string') return encoder.encode(value);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new RenderWorkerWireError('Render worker payload must be UTF-8 JSON', { code: 'ERR_RENDER_WORKER_WIRE_FORMAT' });
}
function assertKeys(value, allowed, requestId = null) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new RenderWorkerWireError(`Unsupported render worker envelope field: ${key}`, { code: 'ERR_RENDER_WORKER_WIRE_FORMAT', requestId });
}
function encodeBounded(value, maxBytes) {
  const bytes = encoder.encode(canonicalOperationLogJson(value));
  if (bytes.byteLength > Math.max(1, Number(maxBytes) || 1)) throw new RenderWorkerWireError('Render worker response exceeds byte limit', { code: 'ERR_RENDER_WORKER_WIRE_RESPONSE_TOO_LARGE', statusCode: 500, requestId: value.requestId ?? null });
  return bytes;
}
function errorEnvelope(requestId, code, message) { return { schema: RENDER_WORKER_WIRE_SCHEMA, type: 'error', requestId, code, message }; }
function resultEnvelope(request, outcome) {
  const result = outcome.result ?? {};
  return {
    schema: RENDER_WORKER_WIRE_SCHEMA,
    type: 'worker.result',
    requestId: request.requestId,
    action: result.type ?? request.message.type,
    verified: true,
    committed: Boolean(outcome.committed),
    jobId: result.jobId ?? request.message.jobId,
    chunkId: result.chunkId ?? request.message.chunk.id,
    index: result.index ?? request.message.chunk.index,
    attempt: result.attempt ?? (request.message.type === 'claim' ? request.message.chunk.expectedAttempt : request.message.chunk.attempt),
    artifactIntegrity: result.type === 'complete' ? (result.artifactIntegrity ?? request.message.artifactIntegrity) : null,
  };
}
export function createRenderWorkerWireRequest(message, { requestId } = {}) {
  validateRenderWorkerMessage(message, { requireSignature: true });
  return { schema: RENDER_WORKER_WIRE_SCHEMA, type: 'worker.submit', requestId: token(requestId, 'Render worker requestId'), message: clone(message) };
}
export function parseRenderWorkerWireRequest(value, { maxBytes = 256 * 1024 } = {}) {
  const bytes = bytesOf(value), limit = Math.max(1, Number(maxBytes) || 1);
  if (bytes.byteLength > limit) throw new RenderWorkerWireError('Render worker request exceeds byte limit', { code: 'ERR_RENDER_WORKER_WIRE_TOO_LARGE', statusCode: 413 });
  let parsed;
  try { parsed = JSON.parse(decoder.decode(bytes)); }
  catch { throw new RenderWorkerWireError('Render worker request must be valid UTF-8 JSON', { code: 'ERR_RENDER_WORKER_WIRE_JSON' }); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new RenderWorkerWireError('Render worker request must be an object', { code: 'ERR_RENDER_WORKER_WIRE_FORMAT' });
  assertKeys(parsed, new Set(['schema', 'type', 'requestId', 'message']), parsed.requestId ?? null);
  if (parsed.schema !== RENDER_WORKER_WIRE_SCHEMA) throw new RenderWorkerWireError(`Unsupported render worker wire schema: ${parsed.schema}`, { code: 'ERR_RENDER_WORKER_WIRE_SCHEMA', requestId: parsed.requestId ?? null });
  if (parsed.type !== 'worker.submit') throw new RenderWorkerWireError(`Unsupported render worker request type: ${parsed.type}`, { code: 'ERR_RENDER_WORKER_WIRE_TYPE', requestId: parsed.requestId ?? null });
  token(parsed.requestId, 'Render worker requestId');
  try { validateRenderWorkerMessage(parsed.message, { requireSignature: true }); }
  catch { throw new RenderWorkerWireError('Render worker signed message is malformed', { code: 'ERR_RENDER_WORKER_WIRE_MESSAGE', requestId: parsed.requestId }); }
  return { schema: RENDER_WORKER_WIRE_SCHEMA, type: 'worker.submit', requestId: parsed.requestId, message: clone(parsed.message) };
}
export function encodeRenderWorkerWireRequest(request, { maxBytes = 256 * 1024 } = {}) {
  const parsed = parseRenderWorkerWireRequest(canonicalOperationLogJson(request), { maxBytes });
  return encodeBounded(parsed, maxBytes);
}
function workerError(error, requestId) {
  if (error.code === 'ERR_RENDER_WORKER_SIGNATURE' || error.code === 'ERR_RENDER_WORKER_ACTOR' || error.code === 'ERR_RENDER_WORKER_FRESHNESS' || error.code === 'ERR_RENDER_WORKER_REPLAY') return { statusCode: 401, response: errorEnvelope(requestId, 'authentication-rejected', 'Authentication rejected') };
  if (error.code === 'ERR_RENDER_ARTIFACT_INTEGRITY') return { statusCode: 422, response: errorEnvelope(requestId, 'artifact-rejected', 'Artifact verification rejected') };
  if (['ERR_RENDER_WORKER_JOB', 'ERR_RENDER_WORKER_STATE', 'ERR_RENDER_WORKER_OWNER'].includes(error.code)) return { statusCode: 409, response: errorEnvelope(requestId, 'state-rejected', 'Render worker state rejected') };
  return { statusCode: 400, response: errorEnvelope(requestId, 'message-rejected', 'Render worker message rejected') };
}
export async function submitRenderWorkerWirePayload(value, { submit, maxRequestBytes = 256 * 1024, maxResponseBytes = 64 * 1024 } = {}) {
  if (typeof submit !== 'function') throw new RenderWorkerWireError('Render worker wire submit callback is required', { code: 'ERR_RENDER_WORKER_WIRE_CONFIG', statusCode: 500 });
  let request;
  try {
    request = parseRenderWorkerWireRequest(value, { maxBytes: maxRequestBytes });
    const outcome = await submit(request.message);
    if (!outcome?.verified) {
      const response = errorEnvelope(request.requestId, 'authentication-rejected', 'Authentication rejected');
      return { statusCode: 401, body: encodeBounded(response, maxResponseBytes), response };
    }
    const response = resultEnvelope(request, outcome);
    return { statusCode: 200, body: encodeBounded(response, maxResponseBytes), response };
  } catch (error) {
    if (error instanceof RenderWorkerWireError) {
      const response = errorEnvelope(error.requestId ?? request?.requestId ?? null, error.code, error.statusCode >= 500 ? 'Render worker service error' : error.message);
      return { statusCode: error.statusCode, body: encodeBounded(response, maxResponseBytes), response };
    }
    if (error instanceof TrustRegistryError) {
      const replay = error.code === 'ERR_TRUST_REPLAY';
      const response = errorEnvelope(request?.requestId ?? null, replay ? 'replay-rejected' : 'authentication-rejected', replay ? 'Replay rejected' : 'Authentication rejected');
      return { statusCode: replay ? 409 : 401, body: encodeBounded(response, maxResponseBytes), response };
    }
    if (error instanceof RenderWorkerAuthError) {
      const mapped = workerError(error, request?.requestId ?? null);
      return { ...mapped, body: encodeBounded(mapped.response, maxResponseBytes) };
    }
    throw error;
  }
}
export function parseRenderWorkerWireResponse(value, { maxBytes = 64 * 1024 } = {}) {
  const bytes = bytesOf(value), limit = Math.max(1, Number(maxBytes) || 1);
  if (bytes.byteLength > limit) throw new RenderWorkerWireError('Render worker response exceeds byte limit', { code: 'ERR_RENDER_WORKER_WIRE_RESPONSE_TOO_LARGE', statusCode: 502 });
  let parsed;
  try { parsed = JSON.parse(decoder.decode(bytes)); }
  catch { throw new RenderWorkerWireError('Render worker response must be valid UTF-8 JSON', { code: 'ERR_RENDER_WORKER_WIRE_RESPONSE', statusCode: 502 }); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.schema !== RENDER_WORKER_WIRE_SCHEMA) throw new RenderWorkerWireError('Render worker response schema is invalid', { code: 'ERR_RENDER_WORKER_WIRE_RESPONSE', statusCode: 502 });
  const requestId = parsed.requestId == null ? null : token(parsed.requestId, 'Render worker response requestId');
  if (parsed.type === 'error') {
    assertKeys(parsed, new Set(['schema', 'type', 'requestId', 'code', 'message']), requestId);
    if (typeof parsed.code !== 'string' || !parsed.code || typeof parsed.message !== 'string') throw new RenderWorkerWireError('Render worker error response is invalid', { code: 'ERR_RENDER_WORKER_WIRE_RESPONSE', statusCode: 502, requestId });
    return { schema: RENDER_WORKER_WIRE_SCHEMA, type: 'error', requestId, code: parsed.code, message: parsed.message };
  }
  if (parsed.type !== 'worker.result' || requestId == null) throw new RenderWorkerWireError('Render worker result response is invalid', { code: 'ERR_RENDER_WORKER_WIRE_RESPONSE', statusCode: 502, requestId });
  assertKeys(parsed, new Set(['schema', 'type', 'requestId', 'action', 'verified', 'committed', 'jobId', 'chunkId', 'index', 'attempt', 'artifactIntegrity']), requestId);
  if (!['claim', 'complete'].includes(parsed.action) || parsed.verified !== true || typeof parsed.committed !== 'boolean') throw new RenderWorkerWireError('Render worker result state is invalid', { code: 'ERR_RENDER_WORKER_WIRE_RESPONSE', statusCode: 502, requestId });
  token(parsed.jobId, 'Render worker result jobId', { requestId });
  token(parsed.chunkId, 'Render worker result chunkId', { requestId });
  if (!Number.isSafeInteger(parsed.index) || parsed.index < 0 || !Number.isSafeInteger(parsed.attempt) || parsed.attempt < 1) throw new RenderWorkerWireError('Render worker result coordinate is invalid', { code: 'ERR_RENDER_WORKER_WIRE_RESPONSE', statusCode: 502, requestId });
  if (parsed.action === 'claim' && parsed.artifactIntegrity !== null) throw new RenderWorkerWireError('Render worker claim response must not contain artifact integrity', { code: 'ERR_RENDER_WORKER_WIRE_RESPONSE', statusCode: 502, requestId });
  if (parsed.action === 'complete' && (typeof parsed.artifactIntegrity !== 'string' || !parsed.artifactIntegrity)) throw new RenderWorkerWireError('Render worker completion response integrity is invalid', { code: 'ERR_RENDER_WORKER_WIRE_RESPONSE', statusCode: 502, requestId });
  return clone(parsed);
}
