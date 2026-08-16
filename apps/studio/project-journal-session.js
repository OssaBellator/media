import { normalizeBoundedModelInput, normalizeBoundedModelJsonObject } from '../../packages/core/src/model-input.js';
import {appendOperationLog,canonicalOperationLogJson,createOperationLog,operationLogHead,replayOperationLog,validateOperationLog} from '../../packages/core/src/operation-log.js';
import { normalizeStudioJournalOptions, studioPersistContextHasAssetWrites } from './persistence-context.js';

const PROJECT_JOURNAL_CONFIG_KEYS=new Set(['graph','log','applyTransaction','createTransaction','persist','compact']);
const PROJECT_JOURNAL_RECOVERY_KEYS=new Set(['recovery','applyTransaction','createTransaction','persist','compact']);
const PROJECT_JOURNAL_BUNDLE_KEYS=new Set(['baseGraph','graph','log']);
function dataFields(value,label,allowedKeys){if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${label} must be a plain data object`);const prototype=Object.getPrototypeOf(value);if(prototype!==Object.prototype&&prototype!==null)throw new Error(`${label} must be a plain data object`);const descriptors=Object.getOwnPropertyDescriptors(value),clean={};for(const key of Reflect.ownKeys(descriptors)){if(typeof key!=='string'||!allowedKeys.has(key))throw new Error(`Unsupported ${label} field: ${String(key)}`);const descriptor=descriptors[key];if(!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))throw new Error(`${label} must contain enumerable data fields only`);clean[key]=descriptor.value;}return clean;}
function graphProjectId(graph){const descriptor=Object.getOwnPropertyDescriptor(graph,'projectId');if(!descriptor)return'workspace';if(!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))throw new Error('Project journal graph projectId must be an enumerable data field');const value=descriptor.value;if(typeof value!=='string'||!value||value.length>1024)throw new Error('Project journal graph projectId must be a non-empty string of at most 1024 characters');return value;}
function cloneJson(value){return JSON.parse(canonicalOperationLogJson(value));}
function applyLoggedTransaction(graph,transaction,applyTransaction){return transaction?.checkpointGraph?cloneJson(transaction.checkpointGraph):applyTransaction(graph,transaction);}
export class ProjectJournalSession{
  constructor(options={}){
    const config=dataFields(options,'Project journal constructor options',PROJECT_JOURNAL_CONFIG_KEYS),graph=config.graph,log=config.log??null,applyTransaction=config.applyTransaction,createTransaction=config.createTransaction,persist=config.persist,compact=config.compact??null;
    if(!graph||typeof graph!=='object')throw new Error('ProjectJournalSession requires graph');
    if(typeof applyTransaction!=='function')throw new Error('ProjectJournalSession requires applyTransaction');
    if(typeof createTransaction!=='function')throw new Error('ProjectJournalSession requires createTransaction');
    if(typeof persist!=='function')throw new Error('ProjectJournalSession requires persist');
    if(compact!=null&&typeof compact!=='function')throw new Error('ProjectJournalSession compact must be a function');
    this.graph=graph;this.log=log??createOperationLog({projectId:graphProjectId(graph)});validateOperationLog(this.log);
    this.applyTransaction=applyTransaction;this.createTransaction=createTransaction;this.persist=persist;this.compactPersistence=compact;this.tail=Promise.resolve();this.metrics={commits:0,checkpoints:0,persisted:0,compactions:0,failed:0};
  }
  commit(label,operations,metadata={},options={}){const {persistContext}=normalizeStudioJournalOptions(options),cleanMetadata=normalizeBoundedModelJsonObject(metadata??{},'Project journal commit metadata'),cleanOperations=normalizeBoundedModelInput(operations,'Project journal commit operations',{allowBinary:false});return this.#enqueue(()=>{const transaction=this.createTransaction(label,cleanOperations,cleanMetadata),nextGraph=this.applyTransaction(this.graph,transaction);return{transaction,nextGraph,checkpoint:false,persistContext};});}
  checkpoint(label,graph,metadata={},options={}){if(!graph||typeof graph!=='object')return Promise.reject(new Error('Project journal checkpoint requires graph'));const {persistContext}=normalizeStudioJournalOptions(options),cleanMetadata=normalizeBoundedModelJsonObject(metadata??{},'Project journal checkpoint metadata');return this.#enqueue(()=>{const base=this.createTransaction(label,[],{...cleanMetadata,journalMode:'checkpoint'}),transaction={...base,checkpointGraph:cloneJson(graph)},nextGraph=graph;return{transaction,nextGraph,checkpoint:true,persistContext};});}
  #enqueue(prepare){return this.#serialize(async()=>{const {transaction,nextGraph,checkpoint,persistContext=null}=prepare(),nextLog=appendOperationLog(this.log,transaction),entry=nextLog.entries.at(-1),persistedAssetWrites=studioPersistContextHasAssetWrites(persistContext);this.metrics.commits++;if(checkpoint)this.metrics.checkpoints++;await this.persist(nextGraph,entry,persistContext);this.graph=nextGraph;this.log=nextLog;this.metrics.persisted++;return{graph:this.graph,log:this.log,entry,transaction,persistedAssetWrites};});}
  compact(metadata={}){const cleanMetadata=normalizeBoundedModelJsonObject(metadata??{},'Project journal compact metadata');return this.#serialize(async()=>{const head=operationLogHead(this.log);if(head.sequence===0)return{compacted:false,graph:this.graph,log:this.log,previousHead:head,persistence:null};if(!this.compactPersistence)throw new Error('ProjectJournalSession requires compact persistence');const persistence=await this.compactPersistence({graph:this.graph,sequence:head.sequence,checksum:head.checksum,metadata:cleanMetadata});this.log=createOperationLog({projectId:this.log.projectId,baseRevision:0,metadata:{}});this.metrics.compactions++;return{compacted:true,graph:this.graph,log:this.log,previousHead:head,persistence};});}
  #serialize(run){const wrapped=async()=>{try{return await run();}catch(error){this.metrics.failed++;throw error;}};const task=this.tail.then(wrapped,wrapped);this.tail=task.then(()=>undefined,()=>undefined);return task;}
  snapshot(){return{graph:this.graph,log:cloneJson(this.log),metrics:{...this.metrics}};}
  stats(){return{...this.metrics,sequence:this.log.entries.length,projectId:this.log.projectId};}
}
export function recoverProjectJournalSession(options={}){
  const config=dataFields(options,'Project journal recovery options',PROJECT_JOURNAL_RECOVERY_KEYS),bundle=dataFields(config.recovery,'Project journal recovery bundle',PROJECT_JOURNAL_BUNDLE_KEYS),{baseGraph,graph,log}=bundle,applyTransaction=config.applyTransaction,createTransaction=config.createTransaction,persist=config.persist,compact=config.compact??null;
  if(!baseGraph||!graph||!log)throw new Error('Project journal recovery bundle is incomplete');
  validateOperationLog(log);
  const replayed=replayOperationLog(baseGraph,log,(current,transaction)=>applyLoggedTransaction(current,transaction,applyTransaction));
  if(canonicalOperationLogJson(replayed)!==canonicalOperationLogJson(graph))throw new Error('Operation journal replay does not match stored graph checkpoint');
  return new ProjectJournalSession({graph,log,applyTransaction,createTransaction,persist,compact});
}
