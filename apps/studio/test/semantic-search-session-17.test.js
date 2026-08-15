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
