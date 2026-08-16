import { normalizeBoundedModelJsonObject } from '../../packages/core/src/model-input.js';

export const MAX_STUDIO_ASSET_WRITES = 4096;
export const MAX_STUDIO_ASSET_ID_CHARS = 1024;
export const MAX_STUDIO_ASSET_METADATA_BYTES = 64 * 1024;

const PERSIST_CONTEXT_KEYS = new Set(['assetWrites']);
const JOURNAL_OPTION_KEYS = new Set(['persistContext']);
const ASSET_WRITE_KEYS = new Set(['assetId', 'blob', 'metadata']);

function dataFields(value, label, allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a plain data object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} must be a plain data object`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const clean = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !allowedKeys.has(key)) throw new Error(`Unsupported ${label} field: ${String(key)}`);
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error(`${label} must contain enumerable data fields only`);
    clean[key] = descriptor.value;
  }
  return clean;
}

function normalizeAssetWrite(write, index) {
  const safe = dataFields(write, `Asset write ${index}`, ASSET_WRITE_KEYS);
  if (typeof safe.assetId !== 'string' || !safe.assetId) throw new Error(`Asset write ${index} assetId must be a non-empty string`);
  if (safe.assetId.length > MAX_STUDIO_ASSET_ID_CHARS) throw new Error(`Asset write ${index} assetId exceeds ${MAX_STUDIO_ASSET_ID_CHARS} characters`);
  if (!safe.blob || typeof safe.blob !== 'object') throw new Error(`Asset write ${index} requires opaque blob data`);
  const metadata = normalizeBoundedModelJsonObject(safe.metadata ?? {}, `Asset write ${index} metadata`, { maxBytes: MAX_STUDIO_ASSET_METADATA_BYTES });
  return { assetId: safe.assetId, blob: safe.blob, metadata };
}

export function normalizeStudioAssetWrites(assetWrites = []) {
  if (!Array.isArray(assetWrites) || assetWrites.length > MAX_STUDIO_ASSET_WRITES) throw new Error(`Asset writes must be an array with at most ${MAX_STUDIO_ASSET_WRITES} entries`);
  const writes = [];
  for (let index = 0; index < assetWrites.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(assetWrites, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('Asset writes must contain dense enumerable data entries only');
    writes.push(normalizeAssetWrite(descriptor.value, index));
  }
  return writes;
}

export function normalizeStudioPersistContext(persistContext = null) {
  if (persistContext == null) return null;
  const safe = dataFields(persistContext, 'Studio persistence context', PERSIST_CONTEXT_KEYS);
  return { assetWrites: normalizeStudioAssetWrites(safe.assetWrites ?? []) };
}

export function normalizeStudioJournalOptions(options = {}) {
  if (options == null) return { persistContext: null };
  const safe = dataFields(options, 'Studio journal options', JOURNAL_OPTION_KEYS);
  return { persistContext: normalizeStudioPersistContext(safe.persistContext ?? null) };
}

export function studioPersistContextHasAssetWrites(persistContext) {
  return Boolean(persistContext?.assetWrites.length);
}
