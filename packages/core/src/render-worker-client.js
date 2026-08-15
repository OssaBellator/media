import { createRenderWorkerWireRequest, encodeRenderWorkerWireRequest, parseRenderWorkerWireResponse } from './render-worker-wire.js';
import { DEFAULT_RENDER_WORKER_HTTP_PATH } from './render-worker-http.js';

export class RenderWorkerClientError extends Error {
  constructor(message, { code = 'render-worker-client-error', statusCode = 0, requestId = null, response = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'RenderWorkerClientError';
    this.code = code;
    this.statusCode = statusCode;
    this.requestId = requestId;
    this.response = response;
  }
}
function headersOf(headers) { const out = new Headers(headers ?? {}); out.set('Content-Type', 'application/json'); out.set('Accept', 'application/json'); return out; }
async function readBoundedResponse(response, maxBytes) {
  const limit = Math.max(1, Number(maxBytes) || 1), declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new RenderWorkerClientError('Render worker response exceeds byte limit', { code: 'response-too-large', statusCode: response.status });
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader(), parts = []; let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value); total += bytes.byteLength;
      if (total > limit) { await reader.cancel('response too large').catch(() => {}); throw new RenderWorkerClientError('Render worker response exceeds byte limit', { code: 'response-too-large', statusCode: response.status }); }
      parts.push(bytes);
    }
  } finally { reader.releaseLock?.(); }
  const out = new Uint8Array(total); let offset = 0; for (const part of parts) { out.set(part, offset); offset += part.byteLength; } return out;
}
export async function submitRenderWorkerMessageHttp(message, {
  requestId,
  endpoint = DEFAULT_RENDER_WORKER_HTTP_PATH,
  fetchImpl = globalThis.fetch,
  headers = null,
  signal = null,
  credentials = 'same-origin',
  maxRequestBytes = 256 * 1024,
  maxResponseBytes = 64 * 1024,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new RenderWorkerClientError('Render worker fetch implementation is required', { code: 'client-config' });
  const request = createRenderWorkerWireRequest(message, { requestId }), body = encodeRenderWorkerWireRequest(request, { maxBytes: maxRequestBytes });
  let response;
  try { response = await fetchImpl(endpoint, { method: 'POST', headers: headersOf(headers), body, signal, credentials }); }
  catch (error) { throw new RenderWorkerClientError('Render worker request failed with unknown delivery state; do not automatically retry this signed message', { code: error?.name === 'AbortError' ? 'aborted-unknown-delivery' : 'network-unknown-delivery', requestId, cause: error }); }
  const contentType = (response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new RenderWorkerClientError('Render worker response Content-Type is invalid', { code: 'invalid-response-content-type', statusCode: response.status, requestId });
  let parsed;
  try { parsed = parseRenderWorkerWireResponse(await readBoundedResponse(response, maxResponseBytes), { maxBytes: maxResponseBytes }); }
  catch (error) { if (error instanceof RenderWorkerClientError) throw error; throw new RenderWorkerClientError('Render worker response is invalid', { code: 'invalid-response', statusCode: response.status, requestId, cause: error }); }
  if ((parsed.type === 'worker.result' || parsed.requestId != null) && parsed.requestId !== requestId) throw new RenderWorkerClientError('Render worker response requestId does not match request', { code: 'response-mismatch', statusCode: response.status, requestId, response: parsed });
  if (!response.ok || parsed.type === 'error') throw new RenderWorkerClientError(parsed.type === 'error' ? parsed.message : `Render worker HTTP ${response.status}`, { code: parsed.type === 'error' ? parsed.code : 'http-error', statusCode: response.status, requestId, response: parsed });
  return parsed;
}
