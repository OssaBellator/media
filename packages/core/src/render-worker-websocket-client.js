import {
  createRenderWorkerWireRequest,
  encodeRenderWorkerWireRequest,
  parseRenderWorkerWireResponse,
} from './render-worker-wire.js';

export class RenderWorkerWebSocketClientError extends Error {
  constructor(message, { code = 'render-worker-websocket-client-error', requestId = null, response = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'RenderWorkerWebSocketClientError';
    this.code = code;
    this.requestId = requestId;
    this.response = response;
  }
}

export class RenderWorkerWebSocketClientSession {
  #send;
  #maxPending;
  #maxRequestBytes;
  #maxResponseBytes;
  #pending = new Map();
  #sendTail = Promise.resolve();
  #closed = false;
  #onProtocolError;
  #onUncorrelatedError;

  constructor({
    send,
    maxPending = 8,
    maxRequestBytes = 256 * 1024,
    maxResponseBytes = 64 * 1024,
    onProtocolError = () => {},
    onUncorrelatedError = () => {},
  } = {}) {
    if (typeof send !== 'function') throw new RenderWorkerWebSocketClientError('Render worker WebSocket client requires send callback', { code: 'config' });
    const pending = Math.floor(Number(maxPending));
    if (!Number.isSafeInteger(pending) || pending < 1) throw new RenderWorkerWebSocketClientError('Render worker WebSocket client maxPending must be positive', { code: 'config' });
    if (typeof onProtocolError !== 'function' || typeof onUncorrelatedError !== 'function') throw new RenderWorkerWebSocketClientError('Render worker WebSocket client callbacks must be functions', { code: 'config' });
    this.#send = send;
    this.#maxPending = pending;
    this.#maxRequestBytes = maxRequestBytes;
    this.#maxResponseBytes = maxResponseBytes;
    this.#onProtocolError = onProtocolError;
    this.#onUncorrelatedError = onUncorrelatedError;
  }

  snapshot() { return { closed: this.#closed, pending: [...this.#pending.keys()], maxPending: this.#maxPending }; }

  submit(message, { requestId } = {}) {
    if (this.#closed) return Promise.reject(new RenderWorkerWebSocketClientError('Render worker WebSocket client is closed', { code: 'closed', requestId }));
    if (this.#pending.size >= this.#maxPending) return Promise.reject(new RenderWorkerWebSocketClientError('Render worker WebSocket client pending limit reached', { code: 'backpressure', requestId }));
    const request = createRenderWorkerWireRequest(message, { requestId });
    if (this.#pending.has(request.requestId)) return Promise.reject(new RenderWorkerWebSocketClientError('Render worker requestId is already pending', { code: 'duplicate-request', requestId: request.requestId }));
    const bytes = encodeRenderWorkerWireRequest(request, { maxBytes: this.#maxRequestBytes });
    let resolvePromise;
    let rejectPromise;
    const responsePromise = new Promise((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
    this.#pending.set(request.requestId, { resolve: resolvePromise, reject: rejectPromise });
    const sendRun = this.#sendTail.then(async () => {
      try { await this.#send(bytes); }
      catch (error) {
        const pending = this.#pending.get(request.requestId);
        if (pending) {
          this.#pending.delete(request.requestId);
          pending.reject(new RenderWorkerWebSocketClientError('Render worker WebSocket send failed with unknown delivery state; do not automatically retry this signed message', { code: 'send-unknown-delivery', requestId: request.requestId, cause: error }));
        }
      }
    });
    this.#sendTail = sendRun.catch(() => {});
    return responsePromise;
  }

  async handleMessage(data) {
    let response;
    try { response = parseRenderWorkerWireResponse(data, { maxBytes: this.#maxResponseBytes }); }
    catch (error) {
      const wrapped = new RenderWorkerWebSocketClientError('Render worker WebSocket response is invalid', { code: 'protocol-error', cause: error });
      await this.#onProtocolError(wrapped);
      throw wrapped;
    }
    if (response.requestId == null) {
      const error = new RenderWorkerWebSocketClientError(response.type === 'error' ? response.message : 'Uncorrelated render worker response', { code: response.type === 'error' ? response.code : 'uncorrelated-response', response });
      await this.#onUncorrelatedError(error);
      return { type: 'uncorrelated', response };
    }
    const pending = this.#pending.get(response.requestId);
    if (!pending) {
      const error = new RenderWorkerWebSocketClientError('Render worker WebSocket response has no pending request', { code: 'unsolicited-response', requestId: response.requestId, response });
      await this.#onProtocolError(error);
      throw error;
    }
    this.#pending.delete(response.requestId);
    if (response.type === 'error') {
      pending.reject(new RenderWorkerWebSocketClientError(response.message, { code: response.code, requestId: response.requestId, response }));
      return { type: 'rejected', response };
    }
    pending.resolve(response);
    return { type: 'resolved', response };
  }

  close(reason = 'Render worker WebSocket closed') {
    if (this.#closed) return;
    this.#closed = true;
    for (const [requestId, pending] of this.#pending) pending.reject(new RenderWorkerWebSocketClientError(reason, { code: 'connection-closed', requestId }));
    this.#pending.clear();
  }
}
