import { canonicalOperationLogJson } from './operation-log.js';
import {
  RENDER_WORKER_WIRE_SCHEMA,
  parseRenderWorkerWireRequest,
  submitRenderWorkerWirePayload,
} from './render-worker-wire.js';

const encoder = new TextEncoder();

export class RenderWorkerWebSocketError extends Error {
  constructor(message, { code = 'render-worker-websocket-error', cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'RenderWorkerWebSocketError';
    this.code = code;
  }
}

function errorBytes(code, message, requestId = null) {
  return encoder.encode(canonicalOperationLogJson({ schema: RENDER_WORKER_WIRE_SCHEMA, type: 'error', requestId, code, message }));
}
async function sendOnce(send, bytes) {
  try { await send(bytes); }
  catch (error) { throw new RenderWorkerWebSocketError('Render worker WebSocket response could not be delivered', { code: 'send-failure', cause: error }); }
}

export class RenderWorkerWebSocketSession {
  #submit;
  #send;
  #maxRequestBytes;
  #maxResponseBytes;
  #maxPending;
  #pending = 0;
  #tail = Promise.resolve();
  #sendTail = Promise.resolve();
  #closed = false;

  constructor({ submit, send, maxRequestBytes = 256 * 1024, maxResponseBytes = 64 * 1024, maxPending = 8 } = {}) {
    if (typeof submit !== 'function') throw new RenderWorkerWebSocketError('Render worker WebSocket submit callback is required', { code: 'config' });
    if (typeof send !== 'function') throw new RenderWorkerWebSocketError('Render worker WebSocket send callback is required', { code: 'config' });
    const pending = Math.floor(Number(maxPending));
    if (!Number.isSafeInteger(pending) || pending < 1) throw new RenderWorkerWebSocketError('Render worker WebSocket maxPending must be positive', { code: 'config' });
    this.#submit = submit;
    this.#send = send;
    this.#maxRequestBytes = maxRequestBytes;
    this.#maxResponseBytes = maxResponseBytes;
    this.#maxPending = pending;
  }

  snapshot() { return { pending: this.#pending, maxPending: this.#maxPending, closed: this.#closed }; }
  close() { this.#closed = true; }

  #sendBytes(bytes) {
    const run = this.#sendTail.then(() => sendOnce(this.#send, bytes));
    this.#sendTail = run.catch(() => {});
    return run;
  }

  async #backpressure(data) {
    let requestId = null;
    try { requestId = parseRenderWorkerWireRequest(data, { maxBytes: this.#maxRequestBytes }).requestId; } catch {}
    const body = errorBytes('backpressure', 'Render worker connection is busy', requestId);
    if (body.byteLength > this.#maxResponseBytes) throw new RenderWorkerWebSocketError('Render worker WebSocket response limit is too small', { code: 'config' });
    await this.#sendBytes(body);
    return { statusCode: 429, response: { schema: RENDER_WORKER_WIRE_SCHEMA, type: 'error', requestId, code: 'backpressure', message: 'Render worker connection is busy' }, body };
  }

  handleMessage(data) {
    if (this.#closed) return Promise.reject(new RenderWorkerWebSocketError('Render worker WebSocket session is closed', { code: 'closed' }));
    if (this.#pending >= this.#maxPending) return this.#backpressure(data);
    this.#pending++;
    const run = this.#tail.then(async () => {
      try {
        let result;
        try {
          result = await submitRenderWorkerWirePayload(data, {
            submit: this.#submit,
            maxRequestBytes: this.#maxRequestBytes,
            maxResponseBytes: this.#maxResponseBytes,
          });
        } catch {
          const body = errorBytes('internal-error', 'Render worker service error');
          result = { statusCode: 500, response: { schema: RENDER_WORKER_WIRE_SCHEMA, type: 'error', requestId: null, code: 'internal-error', message: 'Render worker service error' }, body };
        }
        await this.#sendBytes(result.body);
        return result;
      } finally { this.#pending--; }
    });
    this.#tail = run.catch(() => {});
    return run;
  }
}
