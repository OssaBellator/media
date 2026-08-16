import { ProjectJournalSession, recoverProjectJournalSession } from './project-journal-session.js';
import { compactStoredOperationJournal, estimateStorageQuota } from './storage.js';
import { garbageCollectStoredAssetsWithRetention } from './storage-maintenance.js';

export const DEFAULT_JOURNAL_COMPACT_ENTRIES=250;
export const DEFAULT_ASSET_GC_PRESSURE_RATIO=.9;
export const DEFAULT_ASSET_GC_TARGET_RATIO=.8;
export const DEFAULT_ASSET_GC_AGE_MS=30*24*60*60*1000;
const defaultCompact=({sequence,checksum})=>compactStoredOperationJournal({expectedSequence:sequence,expectedChecksum:checksum});

function assertHistory(history){
  if(!history||typeof history!=='object'||!history.present||!Array.isArray(history.past)||!Array.isArray(history.future))throw new Error('HistoryJournalSession requires snapshot history');
  return history;
}
function sameGraph(a,b){return a===b;}
export class HistoryJournalSession{
  constructor({history,projectJournal=null,applyTransaction,createTransaction,persist,compact=defaultCompact,compactThreshold=DEFAULT_JOURNAL_COMPACT_ENTRIES,estimateStorage=estimateStorageQuota,collectAssets=garbageCollectStoredAssetsWithRetention,assetGcPressureRatio=DEFAULT_ASSET_GC_PRESSURE_RATIO,assetGcTargetRatio=DEFAULT_ASSET_GC_TARGET_RATIO,assetGcAgeMs=DEFAULT_ASSET_GC_AGE_MS,commitHistory,undoHistory,redoHistory,createHistory}={}){
    this.history=assertHistory(history);
    if(typeof commitHistory!=='function')throw new Error('HistoryJournalSession requires commitHistory');
    if(typeof undoHistory!=='function')throw new Error('HistoryJournalSession requires undoHistory');
    if(typeof redoHistory!=='function')throw new Error('HistoryJournalSession requires redoHistory');
    if(typeof createHistory!=='function')throw new Error('HistoryJournalSession requires createHistory');
    this.commitHistory=commitHistory;this.undoHistory=undoHistory;this.redoHistory=redoHistory;this.createHistory=createHistory;
    this.projectJournal=projectJournal??new ProjectJournalSession({graph:this.history.present,applyTransaction,createTransaction,persist,compact});this.compactThreshold=Math.max(0,Number(compactThreshold)||0);this.estimateStorage=estimateStorage;this.collectAssets=collectAssets;this.assetGcPressureRatio=Math.max(0,Number(assetGcPressureRatio)||0);this.assetGcTargetRatio=Math.max(0,Math.min(1,Number(assetGcTargetRatio)||0));this.assetGcAgeMs=Math.max(0,Number(assetGcAgeMs)||0);
    if(this.projectJournal.graph!==this.history.present)throw new Error('History and project journal graphs must match');
    this.tail=Promise.resolve();this.metrics={edits:0,graphCommits:0,undos:0,redos:0,replacements:0,compactions:0,assetCollections:0,assetBytesDeleted:0,maintenanceFailures:0,noops:0,failed:0};
  }
  edit(label,operations,metadata={},options={}){return this.#enqueue(async()=>{const result=await this.projectJournal.commit(label,operations,metadata,options);this.history=this.commitHistory(this.history,result.graph,label);this.metrics.edits++;const maintenance=await this.#compactIfNeeded('edit'),assetCleanup=await this.#collectAssetsIfNeeded(result.persistedAssetWrites);return this.#result(result,'edit',maintenance,assetCleanup);});}
  commitGraph(label,graph,metadata={},options={}){if(!graph||typeof graph!=='object')return Promise.reject(new Error('History graph commit requires graph'));return this.commitGraphFactory(label,()=>graph,metadata,options);}
  commitGraphFactory(label,createGraph,metadata={},options={}){if(typeof createGraph!=='function')return Promise.reject(new Error('History graph commit requires createGraph'));return this.#enqueue(async()=>{const graph=createGraph(this.history.present);if(!graph||typeof graph!=='object')throw new Error('History graph factory must return graph');const result=await this.projectJournal.checkpoint(label,graph,{...metadata,historyAction:'commit-graph'},options);this.history=this.commitHistory(this.history,result.graph,label);this.metrics.graphCommits++;const maintenance=await this.#compactIfNeeded('commit-graph'),assetCleanup=await this.#collectAssetsIfNeeded(result.persistedAssetWrites);return this.#result(result,'commit-graph',maintenance,assetCleanup);});}
  undo(metadata={}){return this.#historyCheckpoint('undo',metadata);}
  redo(metadata={}){return this.#historyCheckpoint('redo',metadata);}
  replace(label,graph,metadata={},options={}){if(!graph||typeof graph!=='object')return Promise.reject(new Error('History replacement requires graph'));return this.#enqueue(async()=>{const result=await this.projectJournal.checkpoint(label,graph,{...metadata,historyAction:'replace'},options);this.history=this.createHistory(result.graph);this.metrics.replacements++;const maintenance=await this.#compactIfNeeded('replace'),assetCleanup=await this.#collectAssetsIfNeeded(true);return this.#result(result,'replace',maintenance,assetCleanup);});}
  compact(metadata={}){return this.#enqueue(async()=>{const result=await this.projectJournal.compact(metadata);if(result.compacted)this.metrics.compactions++;return{...result,history:this.history,action:'compact',noOp:!result.compacted};});}
  #historyCheckpoint(action,metadata){return this.#enqueue(async()=>{const next=action==='undo'?this.undoHistory(this.history):this.redoHistory(this.history);if(next===this.history||sameGraph(next.present,this.history.present)){this.metrics.noops++;return{history:this.history,graph:this.history.present,log:this.projectJournal.log,entry:null,transaction:null,action,noOp:true};}const label=action==='undo'?`Undo ${this.history.past.at(-1)?.label??'edit'}`:`Redo ${this.history.future[0]?.label??'edit'}`,result=await this.projectJournal.checkpoint(label,next.present,{...metadata,historyAction:action});this.history=next;this.metrics[action==='undo'?'undos':'redos']++;const maintenance=await this.#compactIfNeeded(action);return this.#result(result,action,maintenance);});}
  #enqueue(run){const task=this.tail.then(run,run).catch((error)=>{this.metrics.failed++;throw error;});this.tail=task.then(()=>undefined,()=>undefined);return task;}
  async #compactIfNeeded(reason){if(!this.compactThreshold||this.projectJournal.stats().sequence<this.compactThreshold)return null;try{const result=await this.projectJournal.compact({reason,threshold:this.compactThreshold});if(result.compacted)this.metrics.compactions++;return result;}catch(error){this.metrics.maintenanceFailures++;return{compacted:false,error};}}
  #retentionGraph(){const nodes={};for(const snapshot of [this.history.present,...this.history.past.map((item)=>item.graph),...this.history.future.map((item)=>item.graph)])for(const node of Object.values(snapshot?.nodes??{}))if(node?.kind==='asset')nodes[String(node.id)]=node;return{projectId:String(this.history.present?.projectId??'history'),nodes};}
  async #collectAssetsIfNeeded(enabled){if(!enabled||typeof this.estimateStorage!=='function'||typeof this.collectAssets!=='function'||!this.assetGcPressureRatio)return null;try{const estimate=await this.estimateStorage();if(!estimate?.quota||Number(estimate.ratio)<this.assetGcPressureRatio)return null;const maxDeleteBytes=Math.max(0,Number(estimate.usage)-Number(estimate.quota)*this.assetGcTargetRatio),result=await this.collectAssets({retentionGraph:this.#retentionGraph(),olderThanMs:this.assetGcAgeMs,maxDeleteBytes});if(result?.deletedIds?.length){this.metrics.assetCollections++;this.metrics.assetBytesDeleted+=Number(result.deleteBytes??0);}return result;}catch(error){this.metrics.maintenanceFailures++;return{deletedIds:[],deleteBytes:0,error};}}
  #result(result,action,maintenance=null,assetCleanup=null){return{...result,log:this.projectJournal.log,history:this.history,action,noOp:false,maintenance,assetCleanup};}
  snapshot(){return{history:this.history,graph:this.history.present,log:this.projectJournal.snapshot().log,metrics:{...this.metrics},journalMetrics:{...this.projectJournal.metrics}};}
  stats(){return{...this.metrics,...this.projectJournal.stats(),historyPast:this.history.past.length,historyFuture:this.history.future.length};}
}
export function recoverHistoryJournalSession({recovery,applyTransaction,createTransaction,persist,compact=defaultCompact,compactThreshold=DEFAULT_JOURNAL_COMPACT_ENTRIES,estimateStorage=estimateStorageQuota,collectAssets=garbageCollectStoredAssetsWithRetention,assetGcPressureRatio=DEFAULT_ASSET_GC_PRESSURE_RATIO,assetGcTargetRatio=DEFAULT_ASSET_GC_TARGET_RATIO,assetGcAgeMs=DEFAULT_ASSET_GC_AGE_MS,commitHistory,undoHistory,redoHistory,createHistory}={}){
  const projectJournal=recoverProjectJournalSession({recovery,applyTransaction,createTransaction,persist,compact}),history=createHistory(recovery.graph);
  return new HistoryJournalSession({history,projectJournal,compactThreshold,estimateStorage,collectAssets,assetGcPressureRatio,assetGcTargetRatio,assetGcAgeMs,commitHistory,undoHistory,redoHistory,createHistory});
}

