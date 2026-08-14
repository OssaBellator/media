const DB_NAME = "media-studio";
const DB_VERSION = 2;
const WORKSPACE_KEY = "current";

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}
function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}
export function localAssetUri(assetId) { return `media://asset/${assetId}`; }

export async function openMediaDatabase() {
  if (!("indexedDB" in globalThis)) return null;
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains("workspace")) database.createObjectStore("workspace", { keyPath: "key" });
    let assets;
    if (!database.objectStoreNames.contains("assets")) assets = database.createObjectStore("assets", { keyPath: "id" });
    else assets = request.transaction.objectStore("assets");
    if (!assets.indexNames.contains("hash")) assets.createIndex("hash", "hash", { unique: false });
    if (!assets.indexNames.contains("name")) assets.createIndex("name", "name", { unique: false });
    if (!database.objectStoreNames.contains("derived")) database.createObjectStore("derived", { keyPath: "key" });
  };
  return requestResult(request);
}

export async function saveStoredGraph(graph) {
  const database = await openMediaDatabase();
  if (!database) return false;
  const transaction = database.transaction("workspace", "readwrite");
  transaction.objectStore("workspace").put({ key: WORKSPACE_KEY, graph, savedAt: new Date().toISOString() });
  await transactionDone(transaction); database.close(); return true;
}
export async function loadStoredGraph() {
  const database = await openMediaDatabase();
  if (!database) return null;
  const transaction = database.transaction("workspace", "readonly");
  const record = await requestResult(transaction.objectStore("workspace").get(WORKSPACE_KEY));
  await transactionDone(transaction); database.close(); return record?.graph ?? null;
}

export async function saveAssetBlob(assetId, blob, metadata = {}) {
  const database = await openMediaDatabase();
  if (!database) return false;
  const transaction = database.transaction("assets", "readwrite");
  transaction.objectStore("assets").put({
    id: assetId,
    blob,
    hash: metadata.hash ?? null,
    name: metadata.name ?? blob.name ?? "",
    mediaKind: metadata.mediaKind ?? null,
    mimeType: metadata.mimeType ?? blob.type ?? "",
    size: metadata.size ?? blob.size ?? 0,
    duration: metadata.duration ?? null,
    width: metadata.width ?? null,
    height: metadata.height ?? null,
    savedAt: new Date().toISOString(),
  });
  await transactionDone(transaction); database.close(); return true;
}
export async function loadAssetBlob(assetId) {
  const database = await openMediaDatabase();
  if (!database) return null;
  const transaction = database.transaction("assets", "readonly");
  const record = await requestResult(transaction.objectStore("assets").get(assetId));
  await transactionDone(transaction); database.close(); return record?.blob ?? null;
}
export async function loadStoredAsset(assetId) {
  const database = await openMediaDatabase();
  if (!database) return null;
  const transaction = database.transaction("assets", "readonly");
  const record = await requestResult(transaction.objectStore("assets").get(assetId));
  await transactionDone(transaction); database.close(); return record ?? null;
}
export async function findStoredAssetByHash(hash) {
  if (!hash) return null;
  const database = await openMediaDatabase();
  if (!database) return null;
  const transaction = database.transaction("assets", "readonly");
  const store = transaction.objectStore("assets");
  const record = store.indexNames.contains("hash") ? await requestResult(store.index("hash").get(hash)) : null;
  await transactionDone(transaction); database.close(); return record ?? null;
}
export async function listStoredAssets() {
  const database = await openMediaDatabase();
  if (!database) return [];
  const transaction = database.transaction("assets", "readonly");
  const records = await requestResult(transaction.objectStore("assets").getAll());
  await transactionDone(transaction); database.close();
  return records.map(({ blob, ...metadata }) => ({ ...metadata, hasBlob: Boolean(blob) }));
}
export async function deleteAssetBlob(assetId) {
  const database = await openMediaDatabase();
  if (!database) return false;
  const transaction = database.transaction("assets", "readwrite");
  transaction.objectStore("assets").delete(assetId);
  await transactionDone(transaction); database.close(); return true;
}
export async function listStoredAssetIds() { return (await listStoredAssets()).map((record) => String(record.id)); }
export async function hasAssetBlob(assetId) { return (await loadAssetBlob(assetId)) !== null; }

export async function saveDerivedArtifact(key, value, metadata = {}) {
  const database = await openMediaDatabase();
  if (!database) return false;
  const transaction = database.transaction("derived", "readwrite");
  transaction.objectStore("derived").put({ key, value, metadata: { ...metadata }, savedAt: new Date().toISOString() });
  await transactionDone(transaction); database.close(); return true;
}
export async function loadDerivedArtifact(key) {
  const database = await openMediaDatabase();
  if (!database) return null;
  const transaction = database.transaction("derived", "readonly");
  const record = await requestResult(transaction.objectStore("derived").get(key));
  await transactionDone(transaction); database.close(); return record ?? null;
}
export async function deleteDerivedArtifact(key) {
  const database = await openMediaDatabase();
  if (!database) return false;
  const transaction = database.transaction("derived", "readwrite");
  transaction.objectStore("derived").delete(key);
  await transactionDone(transaction); database.close(); return true;
}
export async function clearDerivedArtifacts() {
  const database = await openMediaDatabase();
  if (!database) return false;
  const transaction = database.transaction("derived", "readwrite");
  transaction.objectStore("derived").clear();
  await transactionDone(transaction); database.close(); return true;
}
