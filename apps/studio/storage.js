const DB_NAME = "media-studio";
const DB_VERSION = 2;
const WORKSPACE_KEY = "current";
let databasePromise = null;

function requestResult(request) { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed")); }); }
function transactionDone(transaction) { return new Promise((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed")); transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted")); }); }
export function localAssetUri(assetId) { return `media://asset/${assetId}`; }
export async function openMediaDatabase() {
  if (!("indexedDB" in globalThis)) return null;
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("workspace")) database.createObjectStore("workspace", { keyPath: "key" });
      let assets;
      if (!database.objectStoreNames.contains("assets")) assets = database.createObjectStore("assets", { keyPath: "id" }); else assets = request.transaction.objectStore("assets");
      if (!assets.indexNames.contains("hash")) assets.createIndex("hash", "hash", { unique: false });
      if (!assets.indexNames.contains("name")) assets.createIndex("name", "name", { unique: false });
      if (!database.objectStoreNames.contains("derived")) database.createObjectStore("derived", { keyPath: "key" });
    };
    request.onerror = () => { databasePromise = null; reject(request.error ?? new Error("IndexedDB open failed")); };
    request.onblocked = () => { /* versionchange listeners on existing tabs should release the DB */ };
    request.onsuccess = () => { const database = request.result; database.onversionchange = () => { try { database.close(); } finally { databasePromise = null; } }; resolve(database); };
  });
  return databasePromise;
}
export async function closeMediaDatabase(){if(!databasePromise)return;try{const database=await databasePromise;database?.close?.();}finally{databasePromise=null;}}
async function transaction(storeName,mode,run){const database=await openMediaDatabase();if(!database)return null;const tx=database.transaction(storeName,mode);const result=await run(tx.objectStore(storeName),tx);await transactionDone(tx);return result;}
export async function saveStoredGraph(graph) { const result=await transaction("workspace","readwrite",async(store)=>{store.put({ key: WORKSPACE_KEY, graph, savedAt: new Date().toISOString() });return true;});return Boolean(result); }
export async function loadStoredGraph() { const record=await transaction("workspace","readonly",async(store)=>requestResult(store.get(WORKSPACE_KEY)));return record?.graph??null; }
export async function saveAssetBlob(assetId, blob, metadata = {}) { const result=await transaction("assets","readwrite",async(store)=>{store.put({id:assetId,blob,hash:metadata.hash??null,name:metadata.name??blob.name??"",mediaKind:metadata.mediaKind??null,mimeType:metadata.mimeType??blob.type??"",size:metadata.size??blob.size??0,duration:metadata.duration??null,width:metadata.width??null,height:metadata.height??null,savedAt:new Date().toISOString()});return true;});return Boolean(result); }
export async function loadAssetBlob(assetId) { const record=await loadStoredAsset(assetId);return record?.blob??null; }
export async function loadStoredAsset(assetId) { return transaction("assets","readonly",async(store)=>requestResult(store.get(assetId))); }
export async function findStoredAssetByHash(hash) { if(!hash)return null;return transaction("assets","readonly",async(store)=>store.indexNames.contains("hash")?requestResult(store.index("hash").get(hash)):null); }
export async function listStoredAssets() { const records=await transaction("assets","readonly",async(store)=>requestResult(store.getAll()))??[];return records.map(({blob,...metadata})=>({...metadata,hasBlob:Boolean(blob)})); }
export async function deleteAssetBlob(assetId) { const result=await transaction("assets","readwrite",async(store)=>{store.delete(assetId);return true;});return Boolean(result); }
export async function listStoredAssetIds() { return (await listStoredAssets()).map((record)=>String(record.id)); }
export async function hasAssetBlob(assetId) { return (await loadAssetBlob(assetId)) !== null; }
export async function saveDerivedArtifact(key, value, metadata = {}) { const result=await transaction("derived","readwrite",async(store)=>{store.put({key,value,metadata:{...metadata},savedAt:new Date().toISOString()});return true;});return Boolean(result); }
export async function loadDerivedArtifact(key) { return transaction("derived","readonly",async(store)=>requestResult(store.get(key))); }
export async function listDerivedArtifacts({prefix="",limit=Infinity}={}){const records=await transaction("derived","readonly",async(store)=>requestResult(store.getAll()))??[];const text=String(prefix);return records.filter((record)=>!text||String(record.key).startsWith(text)).sort((a,b)=>String(a.key).localeCompare(String(b.key))).slice(0,Number.isFinite(Number(limit))?Math.max(0,Number(limit)):records.length);}
export async function deleteDerivedArtifact(key) { const result=await transaction("derived","readwrite",async(store)=>{store.delete(key);return true;});return Boolean(result); }
export async function deleteDerivedArtifactsByPrefix(prefix){const keys=(await listDerivedArtifacts({prefix})).map((record)=>record.key);if(!keys.length)return 0;await transaction("derived","readwrite",async(store)=>{for(const key of keys)store.delete(key);return true;});return keys.length;}
export async function clearDerivedArtifacts() { const result=await transaction("derived","readwrite",async(store)=>{store.clear();return true;});return Boolean(result); }
export async function estimateStorageQuota(){if(typeof globalThis.navigator?.storage?.estimate!=="function")return null;const result=await globalThis.navigator.storage.estimate();const usage=Number(result?.usage??0),quota=Number(result?.quota??0);return{usage,quota,available:Math.max(0,quota-usage),ratio:quota>0?usage/quota:0};}
