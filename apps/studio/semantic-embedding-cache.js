import {
  assertSemanticEmbeddingIndex,
  createSemanticEmbeddingIndex,
  semanticEmbeddingCacheKey,
  semanticEmbeddingSourceFingerprint,
} from '../../packages/core/src/semantic-embedding.js';
import { deleteDerivedArtifact, loadDerivedArtifact, saveDerivedArtifact } from './storage.js';

function requireFunction(value,label){if(typeof value!=='function')throw new Error(`${label} must be a function`);return value;}

export class SemanticEmbeddingCache {
  constructor({router,load=loadDerivedArtifact,save=saveDerivedArtifact,remove=deleteDerivedArtifact}={}){
    if(!router||typeof router.execute!=='function'||typeof router.list!=='function')throw new Error('Semantic embedding cache requires a model router');
    this.router=router;this.load=requireFunction(load,'Semantic embedding cache load');this.save=requireFunction(save,'Semantic embedding cache save');this.remove=requireFunction(remove,'Semantic embedding cache remove');
  }

  async getOrCreate(graph,{kinds=null,policy={},signal,...indexOptions}={}){
    const sourceFingerprint=semanticEmbeddingSourceFingerprint(graph,{kinds});
    let cacheReadError=null,cacheWriteError=null;
    for(const backend of this.router.list('embed',policy)){
      const key=semanticEmbeddingCacheKey({projectId:graph.projectId,sourceFingerprint,backendId:backend.id,kinds});
      let stored;
      try{stored=await this.load(key);}catch(error){cacheReadError??=error;break;}
      if(!stored)continue;
      const value=stored.value??stored;
      try{
        assertSemanticEmbeddingIndex(value,{projectId:graph.projectId,sourceFingerprint,backendId:backend.id});
        return{index:value,key,cached:true,cacheReadError:null,cacheWriteError:null};
      }catch{try{await this.remove(key);}catch{}}
    }
    const index=await createSemanticEmbeddingIndex(graph,this.router,{kinds,policy,signal,...indexOptions});
    const key=semanticEmbeddingCacheKey({projectId:graph.projectId,sourceFingerprint:index.sourceFingerprint,backendId:index.backendId,kinds});
    try{
      await this.save(key,index,{schema:index.schema,projectId:index.projectId,sourceFingerprint:index.sourceFingerprint,backendId:index.backendId,dimensions:index.dimensions,documents:index.documents.length});
    }catch(error){cacheWriteError=error;}
    return{index,key,cached:false,cacheReadError,cacheWriteError};
  }

  async invalidate(graph,{kinds=null,policy={}}={}){
    const sourceFingerprint=semanticEmbeddingSourceFingerprint(graph,{kinds});
    let removed=0;
    for(const backend of this.router.list('embed',policy)){
      const key=semanticEmbeddingCacheKey({projectId:graph.projectId,sourceFingerprint,backendId:backend.id,kinds});
      try{if(await this.remove(key)!==false)removed+=1;}catch{}
    }
    return removed;
  }
}
