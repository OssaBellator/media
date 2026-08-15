import { canonicalOperationLogJson } from './operation-log.js';

export const DEFAULT_MODEL_INPUT_BYTES = 64 * 1024 * 1024;
export const DEFAULT_MODEL_OPTIONS_BYTES = 64 * 1024;
export const MAX_MODEL_INPUT_DEPTH = 24;
export const MAX_MODEL_INPUT_ENTRIES = 65_536;

const encoder = new TextEncoder();
const typedArrayConstructors = new Map([
  ['[object Int8Array]', Int8Array],
  ['[object Uint8Array]', Uint8Array],
  ['[object Uint8ClampedArray]', Uint8ClampedArray],
  ['[object Int16Array]', Int16Array],
  ['[object Uint16Array]', Uint16Array],
  ['[object Int32Array]', Int32Array],
  ['[object Uint32Array]', Uint32Array],
  ['[object Float32Array]', Float32Array],
  ['[object Float64Array]', Float64Array],
  ...(typeof BigInt64Array === 'function' ? [['[object BigInt64Array]', BigInt64Array]] : []),
  ...(typeof BigUint64Array === 'function' ? [['[object BigUint64Array]', BigUint64Array]] : []),
]);

function boundedPositive(value, fallback, minimum = 1) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum ? Math.floor(number) : fallback;
}
function textBytes(value) { return encoder.encode(String(value)).byteLength; }
function isSharedBuffer(value) { return typeof SharedArrayBuffer === 'function' && value instanceof SharedArrayBuffer; }
function copyView(value, label) {
  if (isSharedBuffer(value.buffer)) throw new Error(`${label} cannot contain SharedArrayBuffer-backed views`);
  if (!(value.buffer instanceof ArrayBuffer)) throw new Error(`${label} contains an unsupported binary view`);
  const copy = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  if (value instanceof DataView) return new DataView(copy);
  const ctor = typedArrayConstructors.get(Object.prototype.toString.call(value));
  if (!ctor) throw new Error(`${label} contains an unsupported typed array`);
  return new ctor(copy);
}

export function normalizeBoundedModelJsonObject(value = {}, label = 'Model options', { maxBytes = DEFAULT_MODEL_OPTIONS_BYTES } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  let canonical;
  try { canonical = canonicalOperationLogJson(value); }
  catch (error) { throw new Error(`${label} must be JSON-safe: ${error.message}`, { cause: error }); }
  const limit = boundedPositive(maxBytes, DEFAULT_MODEL_OPTIONS_BYTES);
  if (textBytes(canonical) > limit) throw new Error(`${label} exceeds ${limit} bytes`);
  return JSON.parse(canonical);
}

export function normalizeBoundedModelInput(value = {}, label = 'Model input', {
  maxBytes = DEFAULT_MODEL_INPUT_BYTES,
  maxDepth = MAX_MODEL_INPUT_DEPTH,
  maxEntries = MAX_MODEL_INPUT_ENTRIES,
} = {}) {
  const byteLimit = boundedPositive(maxBytes, DEFAULT_MODEL_INPUT_BYTES);
  const depthLimit = boundedPositive(maxDepth, MAX_MODEL_INPUT_DEPTH);
  const entryLimit = boundedPositive(maxEntries, MAX_MODEL_INPUT_ENTRIES);
  let bytes = 0;
  let entries = 0;
  const ancestors = new WeakSet();

  const consume = (amount) => {
    bytes += Math.max(0, Number(amount) || 0);
    if (bytes > byteLimit) throw new Error(`${label} exceeds ${byteLimit} bytes`);
  };
  const consumeEntry = () => {
    entries += 1;
    if (entries > entryLimit) throw new Error(`${label} exceeds ${entryLimit} entries`);
  };

  const visit = (input, depth) => {
    if (depth > depthLimit) throw new Error(`${label} exceeds depth ${depthLimit}`);
    if (input === null) { consume(1); return null; }
    if (typeof input === 'string') { consume(textBytes(input)); return input; }
    if (typeof input === 'boolean') { consume(1); return input; }
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) throw new Error(`${label} numbers must be finite`);
      consume(8);
      return input;
    }
    if (typeof input !== 'object') throw new Error(`${label} contains unsupported ${typeof input} data`);
    if (isSharedBuffer(input)) throw new Error(`${label} cannot contain SharedArrayBuffer`);
    if (input instanceof ArrayBuffer) {
      consume(input.byteLength);
      return input.slice(0);
    }
    if (ArrayBuffer.isView(input)) {
      consume(input.byteLength);
      return copyView(input, label);
    }
    if (typeof Blob === 'function' && input instanceof Blob) {
      consume(input.size);
      return input.slice(0, input.size, input.type);
    }
    if (ancestors.has(input)) throw new Error(`${label} cannot contain cycles`);
    ancestors.add(input);
    try {
      if (Array.isArray(input)) {
        if (input.length > entryLimit) throw new Error(`${label} exceeds ${entryLimit} entries`);
        const keys = Reflect.ownKeys(input);
        for (const key of keys) {
          if (key === 'length') continue;
          if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key)) throw new Error(`${label} arrays cannot contain custom properties`);
        }
        const output = new Array(input.length);
        for (let index = 0; index < input.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
          if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new Error(`${label} arrays must be dense data arrays`);
          consumeEntry();
          output[index] = visit(descriptor.value, depth + 1);
        }
        return output;
      }
      const prototype = Object.getPrototypeOf(input);
      if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} objects must be plain data objects`);
      const descriptors = Object.getOwnPropertyDescriptors(input);
      const output = {};
      for (const key of Reflect.ownKeys(descriptors)) {
        if (typeof key !== 'string') throw new Error(`${label} objects cannot contain symbol keys`);
        const descriptor = descriptors[key];
        if (!descriptor.enumerable || !('value' in descriptor)) throw new Error(`${label} objects must contain enumerable data properties only`);
        consumeEntry();
        consume(textBytes(key));
        Object.defineProperty(output, key, { value: visit(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true });
      }
      return output;
    } finally {
      ancestors.delete(input);
    }
  };

  return visit(value, 0);
}
