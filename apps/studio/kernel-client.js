import { createKernelCancel, createKernelTask } from '../../packages/core/src/index.js';
import { createDefaultKernelRuntime } from './kernel-handlers.js';
function abortError(message='Kernel client closed'){const error=new Error(message);error.name='AbortError';return error;}
export class InlineKernelClient {
  constructor({ runtime = createDefaultKernelRuntime() } = {}) { this.runtime = runtime; this.pending = new Map(); this.closed=false; }
  run(kind, payload, { id, priority = 0, onProgress } = {}) { if(this.closed)throw new Error('Kernel client is closed');const task = createKernelTask(kind, payload, { id, priority }); const promise = this.runtime.execute(task, { onProgress }).then((message) => { this.pending.delete(task.id); if (message.type === 'error') { const error = new Error(message.error.message); error.code = message.error.code; error.name=message.error.name??'Error'; throw error; } return message.result; }); this.pending.set(task.id, promise); return { id: task.id, promise, cancel: () => this.runtime.cancel(task.id) }; }
  close() { if(this.closed)return;this.closed=true;for (const id of this.pending.keys()) this.runtime.cancel(id); this.pending.clear(); }
}
export class WorkerKernelClient {
  constructor({ workerFactory = () => new Worker(new URL('./kernel-worker.js', import.meta.url), { type: 'module' }) } = {}) { this.worker = workerFactory(); this.pending = new Map();this.closed=false;this.worker.addEventListener('message', (event) => this.#message(event.data));this.worker.addEventListener?.('error',(event)=>this.#fatal(event?.error??new Error(event?.message??'Kernel worker failed'))); }
  run(kind, payload, { id, priority = 0, transfer = [], onProgress } = {}) { if(this.closed)throw new Error('Kernel client is closed');const task = createKernelTask(kind, payload, { id, priority, clonePayload:false }); let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); this.pending.set(task.id, { resolve, reject, onProgress }); try{this.worker.postMessage(task, transfer);}catch(error){this.pending.delete(task.id);reject(error);}return { id: task.id, promise, cancel: () => { if(!this.pending.has(task.id))return false;this.worker.postMessage(createKernelCancel(task.id));return true; } }; }
  #message(message) { const pending = this.pending.get(message.id); if (!pending) return; if (message.type === 'progress') { pending.onProgress?.(message); return; } this.pending.delete(message.id); if (message.type === 'error') { const error = new Error(message.error.message); error.code = message.error.code;error.name=message.error.name??'Error'; pending.reject(error); } else pending.resolve(message.result); }
  #fatal(error){for(const pending of this.pending.values())pending.reject(error);this.pending.clear();}
  close() { if(this.closed)return;this.closed=true;this.worker.terminate();const error=abortError();for(const pending of this.pending.values())pending.reject(error);this.pending.clear(); }
}
