import assert from 'node:assert/strict';
import test from 'node:test';
import {createGraph} from '../../../packages/core/src/graph.js';
import {applyOperations} from '../../../packages/core/src/operations.js';
import {createCreativeObjectOperations} from '../../../packages/core/src/creative-object.js';
import {ModelRouter} from '../../../packages/core/src/model-router.js';
import {SemanticEmbeddingCache} from '../semantic-embedding-cache.js';

function router(counter){return new ModelRouter().register({id:'embedder',operations:['embed'],invoke:async(_op,input)=>{counter.count+=1;return{vectors:input.texts.map(()=>[1,0,0])};}});}

test('semantic embedding cache builds once then reuses a validated derived index',async()=>{
  let graph=createGraph('Film');graph=applyOperations(graph,createCreativeObjectOperations(graph,{name:'Maya',objectType:'person'}));
  const records=new Map(),counter={count:0};
  const cache=new SemanticEmbeddingCache({router:router(counter),load:async key=>records.get(key)??null,save:async(key,value,metadata)=>{records.set(key,{value,metadata});return true;},remove:async key=>records.delete(key)});
  const first=await cache.getOrCreate(graph,{kinds:['object']});const calls=counter.count;const second=await cache.getOrCreate(graph,{kinds:['object']});
  assert.equal(first.cached,false);assert.equal(second.cached,true);assert.equal(counter.count,calls);assert.equal(first.key,second.key);
});

test('private hidden semantic changes do not invalidate the derived embedding cache',async()=>{
  let graph=createGraph('Film');const hidden=createCreativeObjectOperations(graph,{name:'Hidden',objectType:'person',semantics:{secret:'one'},permissions:{modelAccess:'none'}});graph=applyOperations(graph,hidden);
  const records=new Map(),counter={count:0};const cache=new SemanticEmbeddingCache({router:router(counter),load:async k=>records.get(k)??null,save:async(k,v)=>{records.set(k,{value:v});},remove:async k=>records.delete(k)});
  await cache.getOrCreate(graph,{kinds:['object']});graph=applyOperations(graph,[{type:'node.update',nodeId:hidden[0].node.id,patch:{props:{semantics:{secret:'two'}}}}]);const second=await cache.getOrCreate(graph,{kinds:['object']});
  assert.equal(second.cached,true);
});

test('visible semantic changes produce a new source fingerprint and rebuild embeddings',async()=>{
  let graph=createGraph('Film');const maya=createCreativeObjectOperations(graph,{name:'Maya',objectType:'person'});graph=applyOperations(graph,maya);
  const records=new Map(),counter={count:0};const cache=new SemanticEmbeddingCache({router:router(counter),load:async k=>records.get(k)??null,save:async(k,v)=>{records.set(k,{value:v});},remove:async k=>records.delete(k)});
  const first=await cache.getOrCreate(graph,{kinds:['object']});graph=applyOperations(graph,[{type:'node.update',nodeId:maya[0].node.id,patch:{name:'Maya Updated'}}]);const second=await cache.getOrCreate(graph,{kinds:['object']});
  assert.equal(second.cached,false);assert.notEqual(first.key,second.key);
});

test('corrupt cached embeddings are removed and rebuilt instead of trusted',async()=>{
  let graph=createGraph('Film');graph=applyOperations(graph,createCreativeObjectOperations(graph,{name:'Maya',objectType:'person'}));
  const records=new Map(),counter={count:0};let removed=0;const r=router(counter);const cache=new SemanticEmbeddingCache({router:r,load:async k=>records.get(k)??null,save:async(k,v)=>{records.set(k,{value:v});},remove:async k=>{removed++;return records.delete(k);}});
  const first=await cache.getOrCreate(graph,{kinds:['object']});records.set(first.key,{value:{...first.index,documents:[{...first.index.documents[0],vector:[1,2]}]}});const second=await cache.getOrCreate(graph,{kinds:['object']});
  assert.equal(second.cached,false);assert.equal(removed,1);
});

test('derived-cache read or write failures do not block embedding functionality',async()=>{
  const graph=createGraph('Film'),counter={count:0};
  const readFail=new SemanticEmbeddingCache({router:router(counter),load:async()=>{throw new Error('idb read');},save:async()=>true,remove:async()=>true});const a=await readFail.getOrCreate(graph);assert.equal(a.cached,false);assert.match(a.cacheReadError.message,/idb read/);
  const writeFail=new SemanticEmbeddingCache({router:router(counter),load:async()=>null,save:async()=>{throw new Error('quota');},remove:async()=>true});const b=await writeFail.getOrCreate(graph);assert.equal(b.cached,false);assert.match(b.cacheWriteError.message,/quota/);
});

test('cache rejects getter-bearing stored values without executing them and rebuilds safely',async()=>{
  let graph=createGraph('Film');graph=applyOperations(graph,createCreativeObjectOperations(graph,{name:'Maya',objectType:'person'}));
  const records=new Map(),counter={count:0};let removed=0,getterCalls=0;
  const cache=new SemanticEmbeddingCache({router:router(counter),load:async k=>records.get(k)??null,save:async(k,v)=>{records.set(k,{value:v});return true;},remove:async k=>{removed+=1;return records.delete(k);}});
  const first=await cache.getOrCreate(graph,{kinds:['object']});
  const forged={};Object.defineProperty(forged,'value',{enumerable:true,get(){getterCalls+=1;return first.index;}});records.set(first.key,forged);
  const rebuilt=await cache.getOrCreate(graph,{kinds:['object']});
  assert.equal(getterCalls,0);assert.equal(removed,1);assert.equal(rebuilt.cached,false);assert.notEqual(rebuilt.index,first.index);
});

test('cache returns the detached normalized index instead of the loaded object',async()=>{
  let graph=createGraph('Film');graph=applyOperations(graph,createCreativeObjectOperations(graph,{name:'Maya',objectType:'person'}));
  const records=new Map(),counter={count:0};const cache=new SemanticEmbeddingCache({router:router(counter),load:async k=>records.get(k)??null,save:async(k,v)=>{records.set(k,{value:v});return true;},remove:async k=>records.delete(k)});
  const first=await cache.getOrCreate(graph,{kinds:['object']});const stored=records.get(first.key).value;const second=await cache.getOrCreate(graph,{kinds:['object']});
  assert.equal(second.cached,true);assert.notEqual(second.index,stored);assert.notEqual(second.index.documents,stored.documents);assert.deepEqual(second.index,stored);
});

test('cache constructor rejects accessors and router method getters without executing them',()=>{
  let optionGetterCalls=0;const options={};Object.defineProperty(options,'router',{enumerable:true,get(){optionGetterCalls+=1;return router({count:0});}});
  assert.throws(()=>new SemanticEmbeddingCache(options),/constructor options must contain enumerable data fields only/);assert.equal(optionGetterCalls,0);
  let methodGetterCalls=0;const forgedRouter={list(){return[];}};Object.defineProperty(forgedRouter,'execute',{enumerable:true,get(){methodGetterCalls+=1;return()=>{};}});
  assert.throws(()=>new SemanticEmbeddingCache({router:forgedRouter}),/router execute must be a data method/);assert.equal(methodGetterCalls,0);
});

test('cache getOrCreate rejects accessor and coercive options before routing or storage',async()=>{
  const graph=createGraph('Film'),counter={count:0};let loads=0;const cache=new SemanticEmbeddingCache({router:router(counter),load:async()=>{loads+=1;return null;},save:async()=>true,remove:async()=>true});
  let getterCalls=0;const options={};Object.defineProperty(options,'kinds',{enumerable:true,get(){getterCalls+=1;return['object'];}});
  await assert.rejects(()=>cache.getOrCreate(graph,options),/getOrCreate options must contain enumerable data fields only/);assert.equal(getterCalls,0);assert.equal(loads,0);assert.equal(counter.count,0);
  let coercions=0;const forged={toString(){coercions+=1;return'object';}};await assert.rejects(()=>cache.getOrCreate(graph,{kinds:[forged]}),/kinds must be non-empty strings/);assert.equal(coercions,0);assert.equal(loads,0);
  await assert.rejects(()=>cache.getOrCreate(graph,{unexpected:true}),/Unsupported Semantic embedding cache getOrCreate options field: unexpected/);assert.equal(loads,0);
});

test('cache snapshots routing policy before asynchronous storage work',async()=>{
  const graph=createGraph('Film');const policy={deniedBackendIds:[]};let loadCalls=0;
  const cache=new SemanticEmbeddingCache({router:router({count:0}),load:async()=>{loadCalls+=1;policy.deniedBackendIds.push('embedder');return null;},save:async()=>true,remove:async()=>true});
  const result=await cache.getOrCreate(graph,{policy,maxDocuments:1});
  assert.equal(loadCalls,1);assert.equal(result.cached,false);assert.ok(result.index.documents.length>0);assert.deepEqual(policy.deniedBackendIds,['embedder']);
});
