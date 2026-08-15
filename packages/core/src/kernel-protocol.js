const KINDS = new Set(["demux", "decode-video", "decode-audio", "encode-video", "encode-audio", "thumbnail", "proxy", "waveform", "mux"]);
let serial = 0;
function nextId() { serial += 1; return `kernel_${Date.now().toString(36)}_${serial.toString(36)}`; }
export function createKernelTask(kind, payload = {}, { id = nextId(), priority = 0, transfer = [], clonePayload = true } = {}) { if (!KINDS.has(kind)) throw new Error(`Unsupported kernel task: ${kind}`); return { protocol: "media.kernel.v1", type: "task", id: String(id), kind, priority: Number(priority) || 0, payload: clonePayload ? structuredClone(payload) : payload, transfer }; }
export function createKernelCancel(taskId) { return { protocol: "media.kernel.v1", type: "cancel", id: String(taskId) }; }
export function createKernelResult(taskId, result, metrics = {}) { return { protocol: "media.kernel.v1", type: "result", id: String(taskId), result, metrics: { ...metrics } }; }
export function createKernelError(taskId, error, { retryable = false, code = "KERNEL_ERROR" } = {}) { return { protocol: "media.kernel.v1", type: "error", id: String(taskId), error: { name: error?.name ?? "Error", message: String(error?.message ?? error), code, retryable } }; }
export function assertKernelMessage(message) { if (!message || message.protocol !== "media.kernel.v1" || !["task", "cancel", "result", "error", "progress"].includes(message.type)) throw new Error("Invalid media kernel message"); if (!message.id) throw new Error("Kernel message requires id"); if (message.type === "task" && !KINDS.has(message.kind)) throw new Error(`Unsupported kernel task: ${message.kind}`); return message; }
export class KernelTaskLedger {
  constructor() { this.tasks = new Map(); }
  dispatch(task) { assertKernelMessage(task); if (task.type !== "task") throw new Error("Ledger can only dispatch tasks"); if (this.tasks.has(task.id)) throw new Error(`Duplicate task id: ${task.id}`); this.tasks.set(task.id, { task, status: "pending", progress: 0, result: null, error: null }); return this.get(task.id); }
  start(id) { return this.#update(id, { status: "running" }); }
  progress(id, value) { return this.#update(id, { progress: Math.max(0, Math.min(1, Number(value) || 0)) }); }
  resolve(id, result) { return this.#update(id, { status: "complete", progress: 1, result, error: null }); }
  reject(id, error) { return this.#update(id, { status: "failed", error: String(error?.message ?? error) }); }
  cancel(id) { return this.#update(id, { status: "cancelled" }); }
  get(id) { const value = this.tasks.get(id); return value ? structuredClone(value) : null; }
  summary() { const values = [...this.tasks.values()]; return { total: values.length, pending: values.filter((x) => x.status === "pending").length, running: values.filter((x) => x.status === "running").length, complete: values.filter((x) => x.status === "complete").length, failed: values.filter((x) => x.status === "failed").length, cancelled: values.filter((x) => x.status === "cancelled").length }; }
  #update(id, patch) { const current = this.tasks.get(id); if (!current) throw new Error(`Unknown kernel task: ${id}`); const next = { ...current, ...patch }; this.tasks.set(id, next); return this.get(id); }
}
