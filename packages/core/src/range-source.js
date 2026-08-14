function finiteInteger(value, label, { min = 0 } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number < min) throw new Error(`${label} must be an integer >= ${min}`);
  return number;
}
function bytesOf(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new Error('Range source read must return binary data');
}
function abortIfNeeded(signal) {
  if (!signal?.aborted) return;
  const error = new Error('Range read aborted');
  error.name = 'AbortError';
  throw error;
}
export function assertRangeSource(source) {
  if (!source || typeof source.read !== 'function') throw new Error('Range source requires read(offset, length)');
  finiteInteger(source.size, 'range source size');
  return source;
}
export function normalizeByteRange(range, size) {
  const total = finiteInteger(size, 'size');
  const offset = finiteInteger(range?.offset ?? 0, 'offset');
  const length = finiteInteger(range?.length ?? range?.byteLength ?? 0, 'length');
  if (offset > total || offset + length > total) throw new Error(`Byte range ${offset}+${length} exceeds source size ${total}`);
  return { offset, length, end: offset + length };
}
export function mergeByteRanges(ranges, { gap = 0, maxLength = Number.MAX_SAFE_INTEGER } = {}) {
  const allowedGap = finiteInteger(gap, 'gap');
  const limit = finiteInteger(maxLength, 'maxLength', { min: 1 });
  const normalized = (ranges ?? []).map((range, index) => ({
    offset: finiteInteger(range.offset, `ranges[${index}].offset`),
    length: finiteInteger(range.length ?? range.byteLength, `ranges[${index}].length`),
    index,
  })).filter((range) => range.length > 0).sort((a, b) => a.offset - b.offset || a.index - b.index);
  const output = [];
  for (const range of normalized) {
    const end = range.offset + range.length;
    const previous = output.at(-1);
    if (previous) {
      const mergedEnd = Math.max(previous.end, end);
      const mergedLength = mergedEnd - previous.offset;
      if (range.offset <= previous.end + allowedGap && mergedLength <= limit) {
        previous.end = mergedEnd;
        previous.length = mergedLength;
        previous.members.push(range.index);
        continue;
      }
    }
    output.push({ offset: range.offset, length: range.length, end, members: [range.index] });
  }
  return output;
}
export class MemoryRangeSource {
  constructor(value, { id = 'memory' } = {}) {
    this.bytes = bytesOf(value).slice();
    this.size = this.bytes.byteLength;
    this.id = id;
    this.reads = 0;
    this.bytesRead = 0;
  }
  async read(offset, length, { signal } = {}) {
    abortIfNeeded(signal);
    const range = normalizeByteRange({ offset, length }, this.size);
    const bytes = this.bytes.slice(range.offset, range.end);
    this.reads += 1;
    this.bytesRead += bytes.byteLength;
    return bytes;
  }
  stats() { return { id: this.id, size: this.size, reads: this.reads, bytesRead: this.bytesRead }; }
}
export function createMemoryRangeSource(value, options) { return new MemoryRangeSource(value, options); }
export async function readRange(source, offset, length, options = {}) {
  const target = assertRangeSource(source);
  abortIfNeeded(options.signal);
  const range = normalizeByteRange({ offset, length }, target.size);
  const bytes = bytesOf(await target.read(range.offset, range.length, options));
  if (bytes.byteLength !== range.length) throw new Error(`Range source returned ${bytes.byteLength} bytes for requested ${range.length}`);
  return bytes;
}
export async function readRanges(source, ranges, { signal, mergeGap = 0, maxMergedLength = Number.MAX_SAFE_INTEGER } = {}) {
  const target = assertRangeSource(source);
  const normalized = (ranges ?? []).map((range) => normalizeByteRange(range, target.size));
  const merged = mergeByteRanges(normalized, { gap: mergeGap, maxLength: maxMergedLength });
  const mergedData = new Map();
  for (const range of merged) {
    abortIfNeeded(signal);
    mergedData.set(range, await readRange(target, range.offset, range.length, { signal }));
  }
  return normalized.map((range) => {
    const holder = merged.find((candidate) => range.offset >= candidate.offset && range.end <= candidate.end);
    if (!holder) throw new Error('Merged range lookup failed');
    const bytes = mergedData.get(holder);
    const start = range.offset - holder.offset;
    return bytes.slice(start, start + range.length);
  });
}
export class PagedRangeSource {
  constructor(source, { pageSize = 1024 * 1024, maxBytes = 64 * 1024 * 1024 } = {}) {
    this.source = assertRangeSource(source);
    this.size = this.source.size;
    this.id = `paged:${this.source.id ?? 'source'}`;
    this.pageSize = finiteInteger(pageSize, 'pageSize', { min: 1 });
    this.maxBytes = finiteInteger(maxBytes, 'maxBytes', { min: this.pageSize });
    this.pages = new Map();
    this.inflight = new Map();
    this.clock = 0;
    this.cachedBytes = 0;
    this.hits = 0;
    this.misses = 0;
  }
  pageBounds(index) {
    const offset = index * this.pageSize;
    return { offset, length: Math.min(this.pageSize, this.size - offset) };
  }
  async page(index, { signal } = {}) {
    const existing = this.pages.get(index);
    if (existing) { existing.used = ++this.clock; this.hits += 1; return existing.bytes; }
    if (this.inflight.has(index)) { this.hits += 1; return this.inflight.get(index); }
    this.misses += 1;
    const promise = (async () => {
      const bounds = this.pageBounds(index);
      const bytes = await readRange(this.source, bounds.offset, bounds.length, { signal });
      this.pages.set(index, { bytes, used: ++this.clock });
      this.cachedBytes += bytes.byteLength;
      this.evict(index);
      return bytes;
    })().finally(() => this.inflight.delete(index));
    this.inflight.set(index, promise);
    return promise;
  }
  evict(protectedIndex = null) {
    while (this.cachedBytes > this.maxBytes && this.pages.size > 1) {
      let oldestIndex = null;
      let oldest = Infinity;
      for (const [index, entry] of this.pages) {
        if (index === protectedIndex) continue;
        if (entry.used < oldest) { oldest = entry.used; oldestIndex = index; }
      }
      if (oldestIndex == null) break;
      const entry = this.pages.get(oldestIndex);
      this.pages.delete(oldestIndex);
      this.cachedBytes -= entry.bytes.byteLength;
    }
  }
  async read(offset, length, { signal } = {}) {
    abortIfNeeded(signal);
    const range = normalizeByteRange({ offset, length }, this.size);
    if (!range.length) return new Uint8Array();
    const first = Math.floor(range.offset / this.pageSize);
    const last = Math.floor((range.end - 1) / this.pageSize);
    const output = new Uint8Array(range.length);
    let write = 0;
    for (let index = first; index <= last; index += 1) {
      const page = await this.page(index, { signal });
      const pageOffset = index * this.pageSize;
      const start = Math.max(range.offset, pageOffset);
      const end = Math.min(range.end, pageOffset + page.byteLength);
      const localStart = start - pageOffset;
      const localEnd = end - pageOffset;
      output.set(page.subarray(localStart, localEnd), write);
      write += localEnd - localStart;
    }
    return output;
  }
  clear() { this.pages.clear(); this.cachedBytes = 0; }
  stats() { const requests=this.hits+this.misses; return { size: this.size, pageSize: this.pageSize, cachedPages: this.pages.size, cachedBytes: this.cachedBytes, maxBytes: this.maxBytes, hits: this.hits, misses: this.misses, hitRatio:requests?this.hits/requests:0, upstream:this.source.stats?.()??null }; }
}
export function createPagedRangeSource(source, options) { return new PagedRangeSource(source, options); }
