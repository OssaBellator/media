import { ProjectJournalSession, recoverProjectJournalSession } from './project-journal-session.js';

function assertHistory(history){
  if(!history||typeof history!=='object'||!history.present||!Array.isArray(history.past)||!Array.isArray(history.future))throw new Error('HistoryJournalSession requires snapshot history');
  return history;
}
function sameGraph(a,b){return a===b;}
export class HistoryJournalSession{
  constructor({history,projectJournal=null,applyTransaction,createTransaction,persist,commitHistory,undoHistory,redoHistory,createHistory}={}){
    this.history=assertHistory(history);
    if(typeof commitHistory!=='function')throw new Error('HistoryJournalSession requires commitHistory');
    if(typeof undoHistory!=='function')throw new Error('HistoryJournalSession requires undoHistory');
    if(typeof redoHistory!=='function')throw new Error('HistoryJournalSession requires redoHistory');
    if(typeof createHistory!=='function')throw new Error('HistoryJournalSession requires createHistory');
    this.commitHistory=commitHistory;this.undoHistory=undoHistory;this.redoHistory=redoHistory;this.createHistory=createHistory;
    this.projectJournal=projectJournal??new ProjectJournalSession({graph:this.history.present,applyTransaction,createTransaction,persist});
    if(this.projectJournal.graph!==this.history.present)throw new Error('History and project journal graphs must match');
    this.tail=Promise.resolve();this.metrics={edits:0,graphCommits:0,undos:0,redos:0,replacements:0,noops:0,failed:0};
  }
  edit(label,operations,metadata={},options={}){return this.#enqueue(async()=>{const result=await this.projectJournal.commit(label,operations,metadata,options);this.history=this.commitHistory(this.history,result.graph,label);this.metrics.edits++;return this.#result(result,'edit');});}
  commitGraph(label,graph,metadata={},options={}){if(!graph||typeof graph!=='object')return Promise.reject(new Error('History graph commit requires graph'));return this.commitGraphFactory(label,()=>graph,metadata,options);}
  commitGraphFactory(label,createGraph,metadata={},options={}){if(typeof createGraph!=='function')return Promise.reject(new Error('History graph commit requires createGraph'));return this.#enqueue(async()=>{const graph=createGraph(this.history.present);if(!graph||typeof graph!=='object')throw new Error('History graph factory must return graph');const result=await this.projectJournal.checkpoint(label,graph,{...metadata,historyAction:'commit-graph'},options);this.history=this.commitHistory(this.history,result.graph,label);this.metrics.graphCommits++;return this.#result(result,'commit-graph');});}
  undo(metadata={}){return this.#historyCheckpoint('undo',metadata);}
  redo(metadata={}){return this.#historyCheckpoint('redo',metadata);}
  replace(label,graph,metadata={},options={}){if(!graph||typeof graph!=='object')return Promise.reject(new Error('History replacement requires graph'));return this.#enqueue(async()=>{const result=await this.projectJournal.checkpoint(label,graph,{...metadata,historyAction:'replace'},options);this.history=this.createHistory(result.graph);this.metrics.replacements++;return this.#result(result,'replace');});}
  #historyCheckpoint(action,metadata){return this.#enqueue(async()=>{const next=action==='undo'?this.undoHistory(this.history):this.redoHistory(this.history);if(next===this.history||sameGraph(next.present,this.history.present)){this.metrics.noops++;return{history:this.history,graph:this.history.present,log:this.projectJournal.log,entry:null,transaction:null,action,noOp:true};}const label=action==='undo'?`Undo ${this.history.past.at(-1)?.label??'edit'}`:`Redo ${this.history.future[0]?.label??'edit'}`,result=await this.projectJournal.checkpoint(label,next.present,{...metadata,historyAction:action});this.history=next;this.metrics[action==='undo'?'undos':'redos']++;return this.#result(result,action);});}
  #enqueue(run){const task=this.tail.then(run,run).catch((error)=>{this.metrics.failed++;throw error;});this.tail=task.then(()=>undefined,()=>undefined);return task;}
  #result(result,action){return{...result,history:this.history,action,noOp:false};}
  snapshot(){return{history:this.history,graph:this.history.present,log:this.projectJournal.snapshot().log,metrics:{...this.metrics},journalMetrics:{...this.projectJournal.metrics}};}
  stats(){return{...this.metrics,...this.projectJournal.stats(),historyPast:this.history.past.length,historyFuture:this.history.future.length};}
}
export function recoverHistoryJournalSession({recovery,applyTransaction,createTransaction,persist,commitHistory,undoHistory,redoHistory,createHistory}={}){
  const projectJournal=recoverProjectJournalSession({recovery,applyTransaction,createTransaction,persist}),history=createHistory(recovery.graph);
  return new HistoryJournalSession({history,projectJournal,commitHistory,undoHistory,redoHistory,createHistory});
}
