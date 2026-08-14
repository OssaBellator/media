const DB_NAME = "media-studio";
const DB_VERSION = 1;
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
    if (!database.objectStoreNames.contains("assets")) database.createObjectStore("assets", { keyPath: "id" });
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
export async function saveAssetBlob(assetId, blob) {
  const database = await openMediaDatabase();
  if (!database) return false;
  const transaction = database.transaction("assets", "readwrite");
  transaction.objectStore("assets").put({ id: assetId, blob, savedAt: new Date().toISOString() });
  await transactionDone(transaction); database.close(); return true;
}
export async function loadAssetBlob(assetId) {
  const database = await openMediaDatabase();
  if (!database) return null;
  const transaction = database.transaction("assets", "readonly");
  const record = await requestResult(transaction.objectStore("assets").get(assetId));
  await transactionDone(transaction); database.close(); return record?.blob ?? null;
}
export async function deleteAssetBlob(assetId) {
  const database = await openMediaDatabase();
  if (!database) return false;
  const transaction = database.transaction("assets", "readwrite");
  transaction.objectStore("assets").delete(assetId);
  await transactionDone(transaction); database.close(); return true;
}
export async function listStoredAssetIds() {
  const database = await openMediaDatabase();
  if (!database) return [];
  const transaction = database.transaction("assets", "readonly");
  const keys = await requestResult(transaction.objectStore("assets").getAllKeys());
  await transactionDone(transaction); database.close(); return keys.map(String);
}
export async function hasAssetBlob(assetId) { return (await loadAssetBlob(assetId)) !== null; }
