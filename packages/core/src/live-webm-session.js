import { AppendRangeSource } from './append-range-source.js';
import { createLiveWebmClusterIndexer } from './webm-live.js';
function chunkEnd(chunk){return Number(chunk.offset??0)+Number(chunk.byteLength??0);}
export class LiveWebmSession{
  constructor({source=null,indexer=null,sourceOptions={},indexerOptions={}}={}){this.source=source??new AppendRangeSource({id:'live-webm',...sourceOptions});this.indexer=indexer??createLiveWebmClusterIndexer(indexerOptions);this.pending=new Map();this.totalChunks=0;this.ackedChunks=0;}
  append(bytes){return this.source.append(bytes);}
  async refresh({signal}={}){const result=await this.indexer.refresh(this.source,{signal});for(const chunk of result.newChunks){const key=`${chunk.offset}:${chunk.byteLength}`;if(!this.pending.has(key)){this.pending.set(key,chunk);this.totalChunks++;}}return{...result,pending:[...this.pending.values()],sourceStats:this.source.stats?.()??null};}
  acknowledgeThrough(offset){offset=Math.max(0,Number(offset)||0);for(const [key,chunk] of [...this.pending])if(chunkEnd(chunk)<=offset){this.pending.delete(key);this.ackedChunks++;}return this.pruneConsumed();}
  acknowledgeChunk(chunk){const key=`${chunk.offset}:${chunk.byteLength}`;if(this.pending.delete(key))this.ackedChunks++;return this.pruneConsumed();}
  pruneConsumed(){const pendingStart=this.pending.size?Math.min(...[...this.pending.values()].map((chunk)=>Number(chunk.offset))):Infinity,openStart=Number(this.indexer.openCluster?.offset??Infinity),cursor=Number(this.indexer.cursor??this.source.startOffset??0),safe=Math.min(pendingStart,openStart,cursor,this.source.size);if(Number.isFinite(safe)&&safe>Number(this.source.startOffset??0))return this.source.pruneBefore?.(safe)??0;return 0;}
  async waitForBytes(size,{signal}={}){return this.source.waitForSize(size,{signal});}
  close(error=null){this.source.close?.(error);}
  stats(){return{totalChunks:this.totalChunks,ackedChunks:this.ackedChunks,pendingChunks:this.pending.size,source:this.source.stats?.()??null,clusters:this.indexer.clusterCount??null};}
}
