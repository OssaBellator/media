import {
  createCollaborationSubmitRequest,
  encodeCollaborationWireRequest,
  parseCollaborationWireResponse,
} from './collaboration-wire.js';

export class CollaborationWebSocketClientError extends Error {
  constructor(message, { code = 'websocket-client-error', requestId = null, response = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'CollaborationWebSocketClientError';
    this.code = code;
    this.requestId = requestId;
    this.response = response;
  }
}

export class CollaborationWebSocketClientSession {
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
    maxRequestBytes = 1024 * 1024,
    maxResponseBytes = 256 * 1024,
    onProtocolError = () => {},
    onUncorrelatedError = () => {},
  } = {}) {
    if (typeof send !== 'function') throw new CollaborationWebSocketClientError('Collaboration WebSocket client requires send callback', { code: 'config' });
    const pending = Math.floor(Number(maxPending));
    if (!Number.isSafeInteger(pending) || pending < 1) throw new CollaborationWebSocketClientError('Collaboration WebSocket client maxPending must be positive', { code: 'config' });
    if (typeof onProtocolError !== 'function' || typeof onUncorrelatedError !== 'function') throw new CollaborationWebSocketClientError('Collaboration WebSocket client callbacks must be functions', { code: 'config' });
    this.#send = send;
    this.#maxPending = pending;
    this.#maxRequestBytes = maxRequestBytes;
    this.#maxResponseBytes = maxResponseBytes;
    this.#onProtocolError = onProtocolError;
    this.#onUncorrelatedError = onUncorrelatedError;
  }

  snapshot() { return { closed: this.#closed, pending: [...this.#pending.keys()], maxPending: this.#maxPending }; }

  submit(batch, { requestId } = {}) {
    if (this.#closed) return Promise.reject(new CollaborationWebSocketClientError('Collaboration WebSocket client is closed', { code: 'closed', requestId }));
    if (this.#pending.size >= this.#maxPending) return Promise.reject(new CollaborationWebSocketClientError('Collaboration WebSocket client pending limit reached', { code: 'backpressure', requestId }));
    const request = createCollaborationSubmitRequest(batch, { requestId });
    if (this.#pending.has(request.requestId)) return Promise.reject(new CollaborationWebSocketClientError('Collaboration requestId is already pending', { code: 'duplicate-request', requestId: request.requestId }));
    const bytes = encodeCollaborationWireRequest(request, { maxBytes: this.#maxRequestBytes });
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
          pending.reject(new CollaborationWebSocketClientError('Collaboration WebSocket send failed with unknown delivery state', { code: 'send-unknown-delivery', requestId: request.requestId, cause: error }));
        }
      }
    });
    this.#sendTail = sendRun.catch(() => {});
    return responsePromise;
  }

  async handleMessage(data) {
    let response;
    try { response = parseCollaborationWireResponse(data, { maxBytes: this.#maxResponseBytes }); }
    catch (error) {
      const wrapped = new CollaborationWebSocketClientError('Collaboration WebSocket response is invalid', { code: 'protocol-error', cause: error });
      await this.#onProtocolError(wrapped);
      throw wrapped;
    }
    if (response.requestId == null) {
      const error = new CollaborationWebSocketClientError(response.type === 'error' ? response.message : 'Uncorrelated collaboration response', { code: response.type === 'error' ? response.code : 'uncorrelated-response', response });
      await this.#onUncorrelatedError(error);
      return { type: 'uncorrelated', response };
    }
    const pending = this.#pending.get(response.requestId);
    if (!pending) {
      const error = new CollaborationWebSocketClientError('Collaboration WebSocket response has no pending request', { code: 'unsolicited-response', requestId: response.requestId, response });
      await this.#onProtocolError(error);
      throw error;
    }
    this.#pending.delete(response.requestId);
    if (response.type === 'error') {
      pending.reject(new CollaborationWebSocketClientError(response.message, { code: response.code, requestId: response.requestId, response }));
      return { type: 'rejected', response };
    }
    pending.resolve(response);
    return { type: 'resolved', response };
  }

  close(reason = 'Collaboration WebSocket closed') {
    if (this.#closed) return;
    this.#closed = true;
    for (const [requestId, pending] of this.#pending) {
      pending.reject(new CollaborationWebSocketClientError(reason, { code: 'connection-closed', requestId }));
    }
    this.#pending.clear();
  }
}
