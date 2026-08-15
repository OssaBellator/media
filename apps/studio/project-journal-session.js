import {appendOperationLog,canonicalOperationLogJson,createOperationLog,replayOperationLog,validateOperationLog} from '../../packages/core/src/operation-log.js';

function cloneJson(value){return JSON.parse(canonicalOperationLogJson(value));}
function applyLoggedTransaction(graph,transaction,applyTransaction){return transaction?.checkpointGraph?cloneJson(transaction.checkpointGraph):applyTransaction(graph,transaction);}
export class ProjectJournalSession{
  constructor({graph,log=null,applyTransaction,createTransaction,persist}={}){
    if(!graph||typeof graph!=='object')throw new Error('ProjectJournalSession requires graph');
    if(typeof applyTransaction!=='function')throw new Error('ProjectJournalSession requires applyTransaction');
    if(typeof createTransaction!=='function')throw new Error('ProjectJournalSession requires createTransaction');
    if(typeof persist!=='function')throw new Error('ProjectJournalSession requires persist');
    this.graph=graph;this.log=log??createOperationLog({projectId:String(graph.projectId??'workspace')});validateOperationLog(this.log);
    this.applyTransaction=applyTransaction;this.createTransaction=createTransaction;this.persist=persist;this.tail=Promise.resolve();this.metrics={commits:0,checkpoints:0,persisted:0,failed:0};
  }
  commit(label,operations,metadata={}){return this.#enqueue(()=>{const transaction=this.createTransaction(label,operations,metadata),nextGraph=this.applyTransaction(this.graph,transaction);return{transaction,nextGraph,checkpoint:false};});}
  checkpoint(label,graph,metadata={}){if(!graph||typeof graph!=='object')return Promise.reject(new Error('Project journal checkpoint requires graph'));return this.#enqueue(()=>{const base=this.createTransaction(label,[],{...metadata,journalMode:'checkpoint'}),transaction={...base,checkpointGraph:cloneJson(graph)},nextGraph=graph;return{transaction,nextGraph,checkpoint:true};});}
  #enqueue(prepare){
    const run=async()=>{const {transaction,nextGraph,checkpoint}=prepare(),nextLog=appendOperationLog(this.log,transaction),entry=nextLog.entries.at(-1);this.metrics.commits++;if(checkpoint)this.metrics.checkpoints++;try{await this.persist(nextGraph,entry);this.graph=nextGraph;this.log=nextLog;this.metrics.persisted++;return{graph:this.graph,log:this.log,entry,transaction};}catch(error){this.metrics.failed++;throw error;}};
    const task=this.tail.then(run,run);this.tail=task.then(()=>undefined,()=>undefined);return task;
  }
  snapshot(){return{graph:this.graph,log:cloneJson(this.log),metrics:{...this.metrics}};}
  stats(){return{...this.metrics,sequence:this.log.entries.length,projectId:this.log.projectId};}
}
export function recoverProjectJournalSession({recovery,applyTransaction,createTransaction,persist}={}){
  if(!recovery?.baseGraph||!recovery?.graph||!recovery?.log)throw new Error('Project journal recovery bundle is incomplete');
  validateOperationLog(recovery.log);
  const replayed=replayOperationLog(recovery.baseGraph,recovery.log,(graph,transaction)=>applyLoggedTransaction(graph,transaction,applyTransaction));
  if(canonicalOperationLogJson(replayed)!==canonicalOperationLogJson(recovery.graph))throw new Error('Operation journal replay does not match stored graph checkpoint');
  return new ProjectJournalSession({graph:recovery.graph,log:recovery.log,applyTransaction,createTransaction,persist});
}
