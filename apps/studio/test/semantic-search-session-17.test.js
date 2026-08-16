import test from 'node:test';
import assert from 'node:assert/strict';
import { StudioSemanticSearchSession } from '../semantic-search-session.js';

const graph = (fingerprint='fp1') => ({ projectId:'p1', fingerprint, nodes:{ a:{id:'a',kind:'asset',name:'Red Sunset'}, b:{id:'b',kind:'object',name:'Blue Ocean'}, c:{id:'c',kind:'asset',name:'Sunset Ocean'} } });
const index = { sourceFingerprint:'fp1', dimensions:2, documents:[{id:'a'},{id:'b'},{id:'c'}] };

const lexicalSearch = (value, query, { limit = 20 } = {}) => {
  const terms = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  return Object.values(value.nodes ?? {}).map((node) => ({ id: node.id, kind: node.kind, name: node.name, score: terms.reduce((score, term) => score + (node.name.toLowerCase().includes(term) ? 1 : 0), 0) })).filter((result) => result.score > 0).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).slice(0, limit);
};
const embedQuery = (router, value, query, options) => router.embedQuery(value, query, options);
const sourceFingerprint = (value) => value.fingerprint ?? value.projectId;
const createSession = (options = {}) => new StudioSemanticSearchSession({ lexicalSearch, embedQuery, sourceFingerprint, ...options });

test('lexical search is available with no model dependencies', async () => {
  const session = createSession({ getGraph:()=>graph() });
  const result = await session.search('sunset');
  assert.equal(result.mode,'lexical');
  assert.deepEqual(result.results.map(r=>r.id), ['a','c']);
});

test('lexical results publish before embedding work resolves', async () => {
  let release;
  const gate = new Promise((resolve)=>{ release=resolve; });
  const updates=[];
  const cache={ getOrCreate: async()=>{ await gate; return {index,cached:true,key:'k'}; } };
  const router={ execute(){}, embedQuery:async()=>[{id:'c',kind:'asset',name:'Sunset Ocean',score:.9}] };
  const session=createSession({getGraph:()=>graph(),router,embeddingCache:cache,onUpdate:(state)=>updates.push(state)});
  const pending=session.search('sunset');
  assert.equal(session.snapshot().status,'searching');
  assert.deepEqual(session.snapshot().results.map(r=>r.id),['a','c']);
  release();
  const final=await pending;
  assert.equal(final.mode,'hybrid');
  assert.equal(updates[0].mode,'lexical');
});

test('hybrid ranking fuses local lexical and embedding ranks without vectors in state', async () => {
  const cache={ getOrCreate:async()=>({index,cached:true,key:'k'}) };
  const router={ execute(){}, embedQuery:async()=>[{id:'c',kind:'asset',name:'Sunset Ocean',score:.95},{id:'b',kind:'object',name:'Blue Ocean',score:.7}] };
  const session=createSession({getGraph:()=>graph(),router,embeddingCache:cache});
  const result=await session.search('sunset',{limit:3});
  assert.equal(result.mode,'hybrid');
  assert.equal(result.results[0].id,'c');
  assert.equal(result.cache.cached,true);
  assert.equal(JSON.stringify(result).includes('vector'),false);
});

test('semantic search exposes bounded derived-cache prune health without leaking storage records', async () => {
  const cache={ getOrCreate:async()=>({
    index,
    cached:true,
    key:'k',
    cachePrune:{removed:2,retained:1,failed:0,sourceFingerprint:'private-fingerprint',kinds:['object']},
    cachePruneError:Object.assign(new Error('cleanup warning'),{code:'CACHE_PRUNE_WARNING',records:[{secret:'not-for-state'}]}),
  }) };
  const router={ execute(){}, embedQuery:async()=>[{id:'c',kind:'asset',name:'Sunset Ocean',score:.95}] };
  const session=createSession({getGraph:()=>graph(),router,embeddingCache:cache});
  const result=await session.search('sunset');
  assert.deepEqual(result.cache.cachePrune,{removed:2,retained:1,failed:0});
  assert.equal(result.cache.cachePruneError.code,'CACHE_PRUNE_WARNING');
  assert.equal(result.cache.cachePruneError.message,'cleanup warning');
  assert.equal(JSON.stringify(result.cache).includes('private-fingerprint'),false);
  assert.equal(JSON.stringify(result.cache).includes('not-for-state'),false);
});

test('embedding/cache failures gracefully fall back to lexical results', async () => {
  const cache={ getOrCreate:async()=>{ throw Object.assign(new Error('model offline'),{code:'MODEL_OFFLINE'}); } };
  const router={ execute(){} };
  const session=createSession({getGraph:()=>graph(),router,embeddingCache:cache});
  const result=await session.search('ocean');
  assert.equal(result.mode,'lexical-fallback');
  assert.deepEqual(result.results.map(r=>r.id),['b','c']);
  assert.equal(result.error.code,'MODEL_OFFLINE');
});

test('graph changes during embedding discard stale semantic ranking and refresh lexical results', async () => {
  let current=graph('fp1');
  let release;
  const gate=new Promise((resolve)=>{release=resolve;});
  const cache={getOrCreate:async()=>{await gate;return{index,cached:true,key:'k'};}};
  const router={execute(){},embedQuery:async()=>[{id:'a',kind:'asset',name:'Red Sunset',score:.9}]};
  const session=createSession({getGraph:()=>current,router,embeddingCache:cache});
  const pending=session.search('ocean');
  current={...graph('fp2'),nodes:{...graph('fp2').nodes,d:{id:'d',kind:'asset',name:'Ocean Spray'}}};
  release();
  const result=await pending;
  assert.equal(result.mode,'lexical-fallback');
  assert.equal(result.error.code,'SEMANTIC_SEARCH_SOURCE_CHANGED');
  assert.deepEqual(result.results.map(r=>r.id),['b','d','c']);
});

test('older async search cannot overwrite a newer lexical query', async () => {
  let release;
  const gate=new Promise((resolve)=>{release=resolve;});
  const cache={getOrCreate:async()=>{await gate;return{index,cached:true,key:'k'};}};
  const router={execute(){},embedQuery:async()=>[{id:'c',kind:'asset',name:'Sunset Ocean',score:.9}]};
  const session=createSession({getGraph:()=>graph(),router,embeddingCache:cache});
  const older=session.search('sunset');
  const newer=await session.search('blue',{useEmbeddings:false});
  release();
  const superseded=await older;
  assert.equal(superseded.superseded,true);
  assert.equal(session.snapshot().query,'blue');
  assert.deepEqual(newer.results.map(r=>r.id),['b']);
});

test('private-only graph changes can refresh lexical results without invalidating visible embedding ranking', async () => {
  let current=graph('fp1');
  let release;
  const gate=new Promise((resolve)=>{release=resolve;});
  const cache={getOrCreate:async()=>({index,cached:true,key:'k'})};
  const router={execute(){},embedQuery:async()=>{await gate;return[{id:'c',kind:'asset',name:'Sunset Ocean',score:.9}];}};
  const session=createSession({getGraph:()=>current,router,embeddingCache:cache});
  const pending=session.search('ocean');
  current={...graph('fp1'),nodes:{...graph('fp1').nodes,d:{id:'d',kind:'object',name:'Ocean Private Note'}}};
  release();
  const result=await pending;
  assert.equal(result.mode,'hybrid');
  assert.ok(result.lexical.some(r=>r.id==='d'));
});

test('direct lexical search supersedes an older async semantic search', async () => {
  let release;
  const gate=new Promise((resolve)=>{release=resolve;});
  const cache={getOrCreate:async()=>{await gate;return{index,cached:true,key:'k'};}};
  const router={execute(){},embedQuery:async()=>[{id:'c',kind:'asset',name:'Sunset Ocean',score:.9}]};
  const session=createSession({getGraph:()=>graph(),router,embeddingCache:cache});
  const older=session.search('sunset');
  const lexical=session.searchLexical('blue');
  release();
  const superseded=await older;
  assert.equal(superseded.superseded,true);
  assert.equal(session.snapshot().query,'blue');
  assert.deepEqual(lexical.results.map(r=>r.id),['b']);
});

test('semantic search constructor rejects accessor-bearing dependencies without executing them', () => {
  let optionGetterCalls=0;const options={};Object.defineProperty(options,'getGraph',{enumerable:true,get(){optionGetterCalls+=1;return()=>graph();}});
  assert.throws(()=>new StudioSemanticSearchSession(options),/constructor options must contain enumerable data fields only/);assert.equal(optionGetterCalls,0);
  let routerGetterCalls=0;const router={};Object.defineProperty(router,'execute',{enumerable:true,get(){routerGetterCalls+=1;return()=>{};}});
  assert.throws(()=>createSession({getGraph:()=>graph(),router}),/router execute must be a data method/);assert.equal(routerGetterCalls,0);
  let cacheGetterCalls=0;const cache={};Object.defineProperty(cache,'getOrCreate',{enumerable:true,get(){cacheGetterCalls+=1;return async()=>({index});}});
  assert.throws(()=>createSession({getGraph:()=>graph(),router:{execute(){}},embeddingCache:cache}),/embedding cache getOrCreate must be a data method/);assert.equal(cacheGetterCalls,0);
});

test('semantic search validates query and options before lexical or model work', async () => {
  let lexicalCalls=0;const session=new StudioSemanticSearchSession({getGraph:()=>graph(),lexicalSearch:(...args)=>{lexicalCalls+=1;return lexicalSearch(...args);},embedQuery,sourceFingerprint});
  let getterCalls=0;const options={};Object.defineProperty(options,'limit',{enumerable:true,get(){getterCalls+=1;return 5;}});
  await assert.rejects(()=>session.search('sunset',options),/search options must contain enumerable data fields only/);assert.equal(getterCalls,0);assert.equal(lexicalCalls,0);
  await assert.rejects(()=>session.search('sunset',{limit:'5'}),/limit must be an integer/);assert.equal(lexicalCalls,0);
  await assert.rejects(()=>session.search('sunset',{useEmbeddings:'false'}),/useEmbeddings must be a boolean/);assert.equal(lexicalCalls,0);
  await assert.rejects(()=>session.search('sunset',{maxDocuments:'1'}),/maxDocuments must be an integer/);assert.equal(lexicalCalls,0);
  await assert.rejects(()=>session.search('sunset',{maxScalars:2_000_001}),/maxScalars must be an integer/);assert.equal(lexicalCalls,0);
  await assert.rejects(()=>session.search('sunset',{batchSize:257}),/batchSize must be an integer/);assert.equal(lexicalCalls,0);
  await assert.rejects(()=>session.search('x'.repeat(4097)),/query exceeds 4096 characters/);assert.equal(lexicalCalls,0);
  let abortedGetterCalls=0;const forgedSignal={};Object.defineProperty(forgedSignal,'aborted',{enumerable:true,get(){abortedGetterCalls+=1;return false;}});
  await assert.rejects(()=>session.search('sunset',{signal:forgedSignal}),/signal must be an AbortSignal/);assert.equal(abortedGetterCalls,0);assert.equal(lexicalCalls,0);
});

test('semantic search snapshots routing policy before asynchronous cache work', async () => {
  const policy={deniedBackendIds:[]};let seenCachePolicy=null,seenEmbedPolicy=null;
  const cache={getOrCreate:async(_graph,options)=>{seenCachePolicy=options.policy;policy.deniedBackendIds.push('embedder');return{index,cached:false,key:'k'};}};
  const router={execute(){}};
  const session=createSession({getGraph:()=>graph(),router,embeddingCache:cache,embedQuery:async(_router,_index,_query,options)=>{seenEmbedPolicy=options.policy;return[{id:'c',kind:'asset',name:'Sunset Ocean',score:.9}];}});
  const result=await session.search('sunset',{policy});
  assert.equal(result.mode,'hybrid');assert.notEqual(seenCachePolicy,policy);assert.equal(seenCachePolicy.deniedBackendIds.length,0);assert.equal(seenEmbedPolicy.deniedBackendIds.length,0);assert.deepEqual(policy.deniedBackendIds,['embedder']);
});

test('semantic search presentation state drops vector payloads and rejects result accessors without executing them', async () => {
  const vectorSession=new StudioSemanticSearchSession({getGraph:()=>graph(),lexicalSearch:()=>[{id:'a',kind:'asset',name:'Red Sunset',score:1,vector:[1,2,3],sources:JSON.parse('{"__proto__":["safe"]}')} ]});
  const clean=await vectorSession.search('sunset',{useEmbeddings:false});
  assert.equal(JSON.stringify(clean).includes('vector'),false);assert.deepEqual(clean.results[0].sources.__proto__,['safe']);assert.equal(Object.getPrototypeOf(clean.results[0].sources),Object.prototype);

  let getterCalls=0;const forged={id:'a',kind:'asset',name:'Red Sunset',score:1};Object.defineProperty(forged,'vector',{enumerable:true,get(){getterCalls+=1;return[1,2,3];}});
  const forgedSession=new StudioSemanticSearchSession({getGraph:()=>graph(),lexicalSearch:()=>[forged]});
  await assert.rejects(()=>forgedSession.search('sunset',{useEmbeddings:false}),/objects must contain enumerable data properties only/);assert.equal(getterCalls,0);

  const sparse=[];sparse.length=1;
  const sparseSession=new StudioSemanticSearchSession({getGraph:()=>graph(),lexicalSearch:()=>sparse});
  await assert.rejects(()=>sparseSession.search('sunset',{useEmbeddings:false}),/must contain enumerable data results only/);
});

test('semantic search cache and error snapshots never execute injected getters or toString', async () => {
  let cachedGetterCalls=0;const cacheResult={index};Object.defineProperty(cacheResult,'cached',{enumerable:true,get(){cachedGetterCalls+=1;return true;}});
  const session=createSession({getGraph:()=>graph(),router:{execute(){}},embeddingCache:{getOrCreate:async()=>cacheResult}});
  const cacheFallback=await session.search('sunset');
  assert.equal(cacheFallback.mode,'lexical-fallback');assert.equal(cachedGetterCalls,0);

  const pruneSession=createSession({getGraph:()=>graph(),router:{execute(){}},embeddingCache:{getOrCreate:async()=>({index,cachePrune:'invalid'})}});
  const pruneFallback=await pruneSession.search('sunset');
  assert.equal(pruneFallback.mode,'lexical-fallback');assert.match(pruneFallback.error.message,/cache prune must be an object/);

  const primitiveSession=createSession({getGraph:()=>graph(),router:{execute(){}},embeddingCache:{getOrCreate:async()=>false}});
  const primitiveFallback=await primitiveSession.search('sunset');
  assert.equal(primitiveFallback.mode,'lexical-fallback');assert.match(primitiveFallback.error.message,/cache result must be an object/);

  const oversizedIndexSession=createSession({getGraph:()=>graph(),router:{execute(){}},embeddingCache:{getOrCreate:async()=>({index:{...index,dimensions:4097}})}});
  const oversizedIndexFallback=await oversizedIndexSession.search('sunset');
  assert.equal(oversizedIndexFallback.mode,'lexical-fallback');assert.match(oversizedIndexFallback.error.message,/index dimensions are invalid/);

  const primitiveErrorSession=createSession({getGraph:()=>graph(),router:{execute(){}},embeddingCache:{getOrCreate:async()=>{throw false;}}});
  const primitiveErrorFallback=await primitiveErrorSession.search('sunset');
  assert.equal(primitiveErrorFallback.mode,'lexical-fallback');assert.equal(primitiveErrorFallback.error.message,'Semantic search failed');

  let messageGetterCalls=0,codeGetterCalls=0,toStringCalls=0;const error={toString(){toStringCalls+=1;return'secret';}};
  Object.defineProperty(error,'message',{enumerable:true,get(){messageGetterCalls+=1;return'secret';}});Object.defineProperty(error,'code',{enumerable:true,get(){codeGetterCalls+=1;return'SECRET';}});
  const errorSession=createSession({getGraph:()=>graph(),router:{execute(){}},embeddingCache:{getOrCreate:async()=>{throw error;}}});
  const failure=await errorSession.search('sunset');
  assert.equal(failure.error.message,'Semantic search failed');assert.equal(failure.error.code,null);assert.equal(messageGetterCalls,0);assert.equal(codeGetterCalls,0);assert.equal(toStringCalls,0);
});
