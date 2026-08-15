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
