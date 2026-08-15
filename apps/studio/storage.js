import { OPERATION_LOG_SCHEMA, operationLogChecksum, validateOperationLog } from '../../packages/core/src/operation-log.js';
const DB_NAME = "media-studio";
const DB_VERSION = 3;
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
      let journal;
      if (!database.objectStoreNames.contains("journal")) journal = database.createObjectStore("journal", { keyPath: "sequence" }); else journal = request.transaction.objectStore("journal");
      if (!journal.indexNames.contains("transactionId")) journal.createIndex("transactionId", "transactionId", { unique: true });
    };
    request.onerror = () => { databasePromise = null; reject(request.error ?? new Error("IndexedDB open failed")); };
    request.onblocked = () => { /* versionchange listeners on existing tabs should release the DB */ };
    request.onsuccess = () => { const database = request.result; database.onversionchange = () => { try { database.close(); } finally { databasePromise = null; } }; resolve(database); };
  });
  return databasePromise;
}
export async function closeMediaDatabase(){if(!databasePromise)return;try{const database=await databasePromise;database?.close?.();}finally{databasePromise=null;}}
async function databaseTransaction(storeNames,mode,run){const database=await openMediaDatabase();if(!database)return null;const names=Array.isArray(storeNames)?storeNames:[storeNames],tx=database.transaction(names,mode),stores=Object.fromEntries(names.map((name)=>[name,tx.objectStore(name)])),result=await run(stores,tx);await transactionDone(tx);return result;}
async function transaction(storeName,mode,run){return databaseTransaction(storeName,mode,async(stores,tx)=>run(stores[storeName],tx));}
export async function saveStoredGraph(graph) { const result=await databaseTransaction(["workspace","journal"],"readwrite",async({workspace,journal})=>{journal.clear();workspace.put({ key: WORKSPACE_KEY, graph, journalBaseGraph: graph, journalSequence: 0, journalChecksum: null, savedAt: new Date().toISOString() });return true;});return Boolean(result); }
export async function loadStoredGraphCheckpoint(){const record=await transaction("workspace","readonly",async(store)=>requestResult(store.get(WORKSPACE_KEY)));if(!record)return null;return{graph:record.graph??null,journalBaseGraph:record.journalBaseGraph??record.graph??null,journalSequence:Number(record.journalSequence??0),journalChecksum:record.journalChecksum??null,savedAt:record.savedAt??null};}
export async function loadStoredGraph() { return (await loadStoredGraphCheckpoint())?.graph??null; }
function assertJournalEntry(entry){if(!entry||typeof entry!=="object"||Array.isArray(entry))throw new Error("Stored operation entry must be an object");if(entry.schema!==OPERATION_LOG_SCHEMA)throw new Error(`Stored operation entry schema must be ${OPERATION_LOG_SCHEMA}`);if(!Number.isSafeInteger(entry.sequence)||entry.sequence<1)throw new Error("Stored operation entry sequence must be a positive safe integer");if(typeof entry.checksum!=="string"||!entry.checksum)throw new Error("Stored operation entry checksum is required");if(typeof entry.transaction?.id!=="string"||!entry.transaction.id)throw new Error("Stored operation entry transaction id is required");const expected=operationLogChecksum({schema:OPERATION_LOG_SCHEMA,sequence:entry.sequence,transaction:entry.transaction,previousChecksum:entry.previousChecksum??null});if(entry.checksum!==expected)throw new Error(`Stored operation entry ${entry.sequence} checksum mismatch`);return entry;}
export async function saveStoredGraphWithOperation(graph,entry){assertJournalEntry(entry);const result=await databaseTransaction(["workspace","journal"],"readwrite",async({workspace,journal})=>{const current=await requestResult(workspace.get(WORKSPACE_KEY)),expected=Number(current?.journalSequence??0)+1,previousChecksum=current?.journalChecksum??null;if(entry.sequence!==expected)throw new Error(`Operation journal sequence ${entry.sequence} does not follow checkpoint ${expected-1}`);if((entry.previousChecksum??null)!==previousChecksum)throw new Error(`Operation journal entry ${entry.sequence} does not extend checkpoint checksum`);const savedAt=new Date().toISOString(),transactionId=entry.transaction.id;journal.add({...entry,transactionId,savedAt});workspace.put({key:WORKSPACE_KEY,graph,journalBaseGraph:current?.journalBaseGraph??current?.graph??graph,journalSequence:entry.sequence,journalChecksum:entry.checksum,savedAt});return true;});return Boolean(result);}
export async function listStoredOperationEntries({afterSequence=0,limit=Infinity}={}){const records=await transaction("journal","readonly",async(store)=>requestResult(store.getAll()))??[],after=Math.max(0,Number(afterSequence)||0),max=Number.isFinite(Number(limit))?Math.max(0,Number(limit)):records.length;return records.filter((record)=>Number(record.sequence)>after).sort((a,b)=>Number(a.sequence)-Number(b.sequence)).slice(0,max);}
export async function findStoredOperationEntryByTransactionId(transactionId){if(!transactionId)return null;return transaction("journal","readonly",async(store)=>store.indexNames.contains("transactionId")?requestResult(store.index("transactionId").get(String(transactionId))):null);}
export async function loadStoredOperationRecovery(){const checkpoint=await loadStoredGraphCheckpoint();if(!checkpoint)return null;const entries=await listStoredOperationEntries(),projectId=String(checkpoint.journalBaseGraph?.projectId??checkpoint.graph?.projectId??"workspace"),log={schema:OPERATION_LOG_SCHEMA,projectId,baseRevision:0,metadata:{},entries};validateOperationLog(log);const head=entries.at(-1)??null,sequence=head?.sequence??0,checksum=head?.checksum??null;if(sequence!==checkpoint.journalSequence||checksum!==checkpoint.journalChecksum)throw new Error("Operation journal head does not match stored graph checkpoint");return{baseGraph:checkpoint.journalBaseGraph,graph:checkpoint.graph,sequence,checksum,entries,log};}
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
