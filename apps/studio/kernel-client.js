import { createKernelCancel, createKernelTask } from '../../packages/core/src/index.js';
import { createDefaultKernelRuntime } from './kernel-handlers.js';
export class InlineKernelClient {
  constructor({ runtime = createDefaultKernelRuntime() } = {}) { this.runtime = runtime; this.pending = new Map(); }
  run(kind, payload, { id, priority = 0, onProgress } = {}) { const task = createKernelTask(kind, payload, { id, priority }); const promise = this.runtime.execute(task, { onProgress }).then((message) => { this.pending.delete(task.id); if (message.type === 'error') { const error = new Error(message.error.message); error.code = message.error.code; throw error; } return message.result; }); this.pending.set(task.id, promise); return { id: task.id, promise, cancel: () => this.runtime.cancel(task.id) }; }
  close() { for (const id of this.pending.keys()) this.runtime.cancel(id); this.pending.clear(); }
}
export class WorkerKernelClient {
  constructor({ workerFactory = () => new Worker(new URL('./kernel-worker.js', import.meta.url), { type: 'module' }) } = {}) { this.worker = workerFactory(); this.pending = new Map(); this.worker.addEventListener('message', (event) => this.#message(event.data)); }
  run(kind, payload, { id, priority = 0, transfer = [], onProgress } = {}) { const task = createKernelTask(kind, payload, { id, priority }); let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); this.pending.set(task.id, { resolve, reject, onProgress }); this.worker.postMessage(task, transfer); return { id: task.id, promise, cancel: () => { this.worker.postMessage(createKernelCancel(task.id)); return true; } }; }
  #message(message) { const pending = this.pending.get(message.id); if (!pending) return; if (message.type === 'progress') { pending.onProgress?.(message); return; } this.pending.delete(message.id); if (message.type === 'error') { const error = new Error(message.error.message); error.code = message.error.code; pending.reject(error); } else pending.resolve(message.result); }
  close() { this.worker.terminate(); this.pending.clear(); }
}
