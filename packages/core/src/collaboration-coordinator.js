import {canonicalOperationLogJson,operationLogHead,validateOperationLog} from './operation-log.js';
import {operationBatchSigningText,validateOperationBatchStructure} from './operation-batch.js';
import {analyzeOperationBatchRebase} from './operation-conflicts.js';
import {applyTransaction} from './operations.js';
import {TrustedTransitionSession} from './trusted-transition.js';

function clone(value){return JSON.parse(canonicalOperationLogJson(value));}
function batchVerificationContext(batch){validateOperationBatchStructure(batch,{requireSignature:true});const text=operationBatchSigningText(batch),statement=JSON.parse(text);return{statement,text,bytes:new TextEncoder().encode(text),signature:batch.signature,actor:clone(batch.actor)};}
function appendVerifiedEntries(log,batch){const next={...log,metadata:clone(log.metadata??{}),entries:[...log.entries.map(clone),...batch.entries.map(clone)]};validateOperationLog(next);return next;}
export class CollaborationCoordinatorSession{
  #session;
  constructor({trustRegistry,graph,log,persist,verifySignature,now=()=>Date.now(),maxAgeMs=5*60*1000,maxFutureSkewMs=0,nonceRetentionMs=24*60*60*1000,maxNonceEntries=10000}={}){validateOperationLog(log);if(log.projectId!==graph?.projectId)throw new Error('Collaboration coordinator graph/log project mismatch');if(typeof persist!=='function')throw new Error('Collaboration coordinator requires atomic persist callback');this.#session=new TrustedTransitionSession({trustRegistry,state:{graph:clone(graph),log:clone(log)},verifySignature,now,policy:{purpose:'collaboration',schema:'media.operation-batch.v1',maxAgeMs,maxFutureSkewMs,requireNonce:true,nonceRetentionMs,maxNonceEntries},persist:async({trustRegistry,state},metadata)=>persist({trustRegistry,graph:state.graph,log:state.log},metadata)});}
  snapshot(){const value=this.#session.snapshot();return{trustRegistry:value.trustRegistry,graph:value.state.graph,log:value.state.log};}
  async submit(batch){const context=batchVerificationContext(batch),outcome=await this.#session.process(context,(state,{actor})=>{const analysis=analyzeOperationBatchRebase(state.log,batch,{graph:state.graph});if(analysis.status!=='current')return{state,result:{...analysis,actor}};let graph=state.graph;for(const entry of batch.entries)graph=applyTransaction(graph,entry.transaction);const log=appendVerifiedEntries(state.log,batch);return{state:{graph,log},result:{status:'applied',safe:true,requiresResign:false,actor,entries:batch.entries.length,head:operationLogHead(log)}};},{metadata:{type:'collaboration.batch',projectId:batch.projectId,batchActorId:batch.actor.id,batchKeyId:batch.actor.keyId}});return{verified:outcome.verified,committed:outcome.committed,result:outcome.result,trustRegistry:outcome.trustRegistry,graph:outcome.state.graph,log:outcome.state.log};}
}
