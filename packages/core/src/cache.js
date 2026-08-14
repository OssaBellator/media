function finitePositive(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} must be positive`);
  return number;
}

export function frameCacheKey({ assetId, time = 0, fps = 30, width = 0, height = 0, variant = "preview" }) {
  if (typeof assetId !== "string" || !assetId) throw new Error("frameCacheKey requires assetId");
  const safeFps = finitePositive(fps, "fps");
  const frame = Math.max(0, Math.round(Number(time || 0) * safeFps));
  return `${variant}:${assetId}:f${frame}@${safeFps}:${Math.max(0, Math.round(Number(width) || 0))}x${Math.max(0, Math.round(Number(height) || 0))}`;
}

export function sourceCacheKey(asset) {
  if (!asset?.id) throw new Error("sourceCacheKey requires an asset");
  return `source:${asset.props?.hash || asset.id}:${Number(asset.props?.size || 0)}:${asset.props?.mimeType || ""}`;
}

export class WeightedLruCache {
  #entries = new Map();
  #weight = 0;
  #maxWeight;
  #hits = 0;
  #misses = 0;
  #evictions = 0;

  constructor({ maxWeight = 256 * 1024 * 1024 } = {}) {
    this.#maxWeight = finitePositive(maxWeight, "maxWeight");
  }

  get maxWeight() { return this.#maxWeight; }
  get weight() { return this.#weight; }
  get size() { return this.#entries.size; }

  has(key) { return this.#entries.has(key); }

  get(key) {
    const entry = this.#entries.get(key);
    if (!entry) { this.#misses += 1; return undefined; }
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    this.#hits += 1;
    return entry.value;
  }

  peek(key) { return this.#entries.get(key)?.value; }

  set(key, value, weight = 1) {
    if (typeof key !== "string" || !key) throw new Error("Cache key must be a non-empty string");
    const normalizedWeight = finitePositive(weight, "Cache entry weight");
    const existing = this.#entries.get(key);
    if (existing) {
      this.#weight -= existing.weight;
      this.#entries.delete(key);
    }
    if (normalizedWeight > this.#maxWeight) return false;
    this.#entries.set(key, { value, weight: normalizedWeight });
    this.#weight += normalizedWeight;
    this.#evictToBudget();
    return true;
  }

  delete(key) {
    const entry = this.#entries.get(key);
    if (!entry) return false;
    this.#entries.delete(key);
    this.#weight -= entry.weight;
    return true;
  }

  clear() { this.#entries.clear(); this.#weight = 0; }

  resize(maxWeight) {
    this.#maxWeight = finitePositive(maxWeight, "maxWeight");
    this.#evictToBudget();
  }

  stats() {
    const total = this.#hits + this.#misses;
    return {
      entries: this.size,
      weight: this.weight,
      maxWeight: this.maxWeight,
      hits: this.#hits,
      misses: this.#misses,
      evictions: this.#evictions,
      hitRate: total ? this.#hits / total : 0,
    };
  }

  #evictToBudget() {
    while (this.#weight > this.#maxWeight && this.#entries.size) {
      const [key, entry] = this.#entries.entries().next().value;
      this.#entries.delete(key);
      this.#weight -= entry.weight;
      this.#evictions += 1;
    }
  }
}

export class DecodeScheduler {
  #concurrency;
  #active = 0;
  #queue = [];
  #pending = new Map();
  #sequence = 0;

  constructor({ concurrency = 2 } = {}) {
    const parsed = Math.floor(Number(concurrency));
    if (!Number.isFinite(parsed) || parsed < 1) throw new Error("Decode scheduler concurrency must be at least 1");
    this.#concurrency = parsed;
  }

  get active() { return this.#active; }
  get queued() { return this.#queue.length; }
  get pending() { return this.#pending.size; }

  schedule(key, task, { priority = 0, signal } = {}) {
    if (typeof key !== "string" || !key) throw new Error("Decode task key must be a non-empty string");
    if (typeof task !== "function") throw new Error("Decode task must be a function");
    if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    const existing = this.#pending.get(key);
    if (existing) return existing.promise;

    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
    const record = {
      key,
      task,
      priority: Number(priority) || 0,
      sequence: this.#sequence++,
      signal,
      resolve: resolvePromise,
      reject: rejectPromise,
      promise,
      started: false,
    };
    this.#pending.set(key, record);
    this.#queue.push(record);
    this.#sortQueue();
    if (signal) signal.addEventListener("abort", () => this.cancel(key, signal.reason), { once: true });
    queueMicrotask(() => this.#pump());
    return promise;
  }

  cancel(key, reason = new Error("Decode task cancelled")) {
    const record = this.#pending.get(key);
    if (!record || record.started) return false;
    this.#pending.delete(key);
    this.#queue = this.#queue.filter((item) => item !== record);
    record.reject(reason);
    return true;
  }

  reprioritize(key, priority) {
    const record = this.#pending.get(key);
    if (!record || record.started) return false;
    record.priority = Number(priority) || 0;
    this.#sortQueue();
    return true;
  }

  async idle() {
    if (!this.pending) return;
    await new Promise((resolve) => {
      const poll = () => this.pending ? setTimeout(poll, 0) : resolve();
      poll();
    });
  }

  #sortQueue() {
    this.#queue.sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
  }

  #pump() {
    while (this.#active < this.#concurrency && this.#queue.length) {
      const record = this.#queue.shift();
      if (!this.#pending.has(record.key)) continue;
      if (record.signal?.aborted) {
        this.#pending.delete(record.key);
        record.reject(record.signal.reason ?? new Error("Decode task aborted"));
        continue;
      }
      record.started = true;
      this.#active += 1;
      Promise.resolve()
        .then(() => record.task({ signal: record.signal, key: record.key }))
        .then(record.resolve, record.reject)
        .finally(() => {
          this.#active -= 1;
          this.#pending.delete(record.key);
          this.#pump();
        });
    }
  }
}
