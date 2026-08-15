import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {operationBatchTrustVerifier} from '../../../packages/core/src/trust-registry.js';

function memoryDatabase(){
  const data=new Map(),asyncRequest=(read)=>{const request={result:undefined,error:null};queueMicrotask(()=>{try{request.result=read();request.onsuccess?.();}catch(error){request.error=error;request.onerror?.();}});return request;};
  const store={get(key){return asyncRequest(()=>data.get(key));},put(record){data.set(record.key,structuredClone(record));return asyncRequest(()=>record.key);}};
  const db={close(){},onversionchange:null,objectStoreNames:{contains(name){return name==='registry';}},transaction(){const tx={error:null,oncomplete:null,onerror:null,onabort:null,objectStore(){return store;}};setTimeout(()=>tx.oncomplete?.(),0);return tx;}};
  return{db,data};
}
const secret='durable-secret';
const signature=(bytes)=>createHmac('sha256',secret).update(bytes).digest('hex');
const verifySignature=async({bytes,signature:actual,key})=>{if(key.verification.ref!=='alice-public')return false;const expected=Buffer.from(signature(bytes),'hex'),provided=Buffer.from(String(actual),'hex');return expected.length===provided.length&&timingSafeEqual(expected,provided);};
function context(nonce){const statement={schema:'media.operation-batch.v1',actor:{id:'alice',keyId:'k1'},issuedAt:1000,nonce},bytes=new TextEncoder().encode(JSON.stringify(statement));return{statement,actor:statement.actor,bytes,signature:signature(bytes)};}

test('stored trust registry compare-and-swap persists nonce across session restart',async()=>{const memory=memoryDatabase();globalThis.indexedDB={open(_name,version){assert.equal(version,1);const request={result:memory.db,error:null};queueMicrotask(()=>request.onsuccess?.());return request;}};const module=await import(`../trust-storage.js?durable=${Date.now()}`);let session=await module.createStoredTrustRegistrySession({verifySignature,now:()=>1100,maxAgeMs:1000});await session.enrollActor({actorId:'alice',now:900});await session.enrollKey({actorId:'alice',keyId:'k1',purposes:['collaboration'],verification:{ref:'alice-public'},now:900});const verify=operationBatchTrustVerifier(session);assert.equal(await verify(context('nonce-1')),true);const persisted=await module.loadStoredTrustRegistry();assert.equal(persisted.revision,3);assert.equal(Object.keys(persisted.nonces).length,1);await module.closeTrustDatabase();session=await module.createStoredTrustRegistrySession({verifySignature,now:()=>1100,maxAgeMs:1000});await assert.rejects(()=>operationBatchTrustVerifier(session)(context('nonce-1')),/already been consumed/);await module.closeTrustDatabase();});

test('stored trust registry rejects stale writers with revision compare-and-swap',async()=>{const memory=memoryDatabase();globalThis.indexedDB={open(){const request={result:memory.db,error:null};queueMicrotask(()=>request.onsuccess?.());return request;}};const module=await import(`../trust-storage.js?cas=${Date.now()}`),first=await module.createStoredTrustRegistrySession({verifySignature:async()=>true,now:()=>1000}),second=await module.createStoredTrustRegistrySession({verifySignature:async()=>true,now:()=>1000});await first.enrollActor({actorId:'first',now:1000});await assert.rejects(()=>second.enrollActor({actorId:'second',now:1000}),/compare-and-swap expected revision 0 but found 1/);assert.equal(second.snapshot().revision,0);await module.closeTrustDatabase();});

test('durable trust session fails closed when IndexedDB is unavailable',async()=>{delete globalThis.indexedDB;const module=await import(`../trust-storage.js?missing=${Date.now()}`);const session=await module.createStoredTrustRegistrySession({verifySignature:async()=>true,now:()=>1000});await assert.rejects(()=>session.enrollActor({actorId:'a',now:1000}),/durable storage is unavailable/);assert.equal(session.snapshot().revision,0);});
