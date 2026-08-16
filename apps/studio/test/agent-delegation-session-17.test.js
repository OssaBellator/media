import assert from 'node:assert/strict';
import test from 'node:test';
import { createGraph } from '../../../packages/core/src/graph.js';
import { applyTransaction } from '../../../packages/core/src/operations.js';
import { createAgentPlan } from '../../../packages/core/src/agent-plan.js';
import { createAgentWorkflow } from '../../../packages/core/src/agent-workflow.js';
import { createPlannerProvider } from '../../../packages/core/src/providers.js';
import { ModelRouter } from '../../../packages/core/src/model-router.js';
import { AgentProposalSession } from '../agent-proposal-session.js';
import { AgentWorkflowSession } from '../agent-workflow-session.js';
import {
  AgentDelegationSession,
  MAX_AGENT_DELEGATION_REVIEW_ID_CHARS,
  MAX_AGENT_DELEGATION_REVIEW_TASKS,
  summarizeAgentDelegationWorkflow,
} from '../agent-delegation-session.js';

function noopProvider(){return createPlannerProvider({id:'noop',plan:async()=>({summary:'noop',operations:[]})});}

test('delegation workflow review summary is bounded and excludes task payloads and errors',()=>{
  const graph=createGraph('Review boundary');
  const plan=createAgentPlan(graph,{intent:'inspect workflow',providerId:'mock',operations:[]});
  const tasks=Array.from({length:MAX_AGENT_DELEGATION_REVIEW_TASKS+6},(_,index)=>index===0
    ? {id:`<task-${'x'.repeat(220)}>`,kind:'generate-media',payload:{operation:'generate-image',settings:{secret:'never-render-payload'}}}
    : {id:`task-${index}`,kind:'semantic-enrichment',payload:{sourceNodeIds:[]}});
  const workflow=createAgentWorkflow(plan,tasks);
  workflow.tasks[0].error='never-render-error';
  const summary=summarizeAgentDelegationWorkflow(workflow,{assetWriteCount:3});
  assert.equal(summary.tasks.length,MAX_AGENT_DELEGATION_REVIEW_TASKS);
  assert.equal(summary.truncatedTaskCount,6);
  assert.equal(summary.taskCount,MAX_AGENT_DELEGATION_REVIEW_TASKS+6);
  assert.equal(summary.assetWriteCount,3);
  assert.ok(summary.tasks[0].id.length<=MAX_AGENT_DELEGATION_REVIEW_ID_CHARS);
  assert.deepEqual(Object.keys(summary.tasks[0]).sort(),['dependencyCount','id','kind','optional','status']);
  const serialized=JSON.stringify(summary);
  assert.equal(serialized.includes('never-render-payload'),false);
  assert.equal(serialized.includes('never-render-error'),false);
  assert.equal(serialized.includes('generate-image'),false);
});

test('delegation summary rejects accessor options and coercive counts without execution',()=>{
  const graph=createGraph('Summary boundary');
  const plan=createAgentPlan(graph,{intent:'inspect',providerId:'mock',operations:[]});
  const workflow=createAgentWorkflow(plan,[]);
  let getterCalls=0;let coercions=0;
  const options={};Object.defineProperty(options,'assetWriteCount',{enumerable:true,get(){getterCalls++;return 1;}});
  assert.throws(()=>summarizeAgentDelegationWorkflow(workflow,options),/summary options must contain enumerable data fields only/);
  assert.throws(()=>summarizeAgentDelegationWorkflow(workflow,{assetWriteCount:{valueOf(){coercions++;return 1;}}}),/assetWriteCount must be an integer/);
  assert.equal(getterCalls,0);assert.equal(coercions,0);
});

test('delegation constructor captures data methods without executing accessors',()=>{
  let getterCalls=0;
  const proposal={adopt(){},apply(){},discard(){},select(){},snapshot(){return{status:'idle',plan:null,review:null,error:null};}};
  const workflow={};Object.defineProperty(workflow,'execute',{get(){getterCalls++;return async()=>({});}});
  assert.throws(()=>new AgentDelegationSession({proposalSession:proposal,workflowSession:workflow}),/execute must be a data method/);
  const options={workflowSession:{execute:async()=>({})}};Object.defineProperty(options,'proposalSession',{enumerable:true,get(){getterCalls++;return proposal;}});
  assert.throws(()=>new AgentDelegationSession(options),/session options must contain enumerable data fields only/);
  assert.equal(getterCalls,0);
});

test('delegation rejects executable workflow result envelopes before proposal adoption',async()=>{
  const graph=createGraph('Result boundary');
  const plan=createAgentPlan(graph,{intent:'inspect',providerId:'mock',operations:[]});
  const workflow=createAgentWorkflow(plan,[]);
  let getterCalls=0;let adopts=0;
  const result={workflow,taskResults:{},persistContext:null,previewGraph:graph};
  Object.defineProperty(result,'plan',{enumerable:true,get(){getterCalls++;return plan;}});
  const proposal={adopt(){adopts++;},apply:async()=>({plan:null,transaction:null,persistContext:null,result:null}),discard(){return null;},select(){return{status:'idle',plan:null,review:null,error:null};},snapshot(){return{status:'idle',plan:null,review:null,error:null};}};
  const session=new AgentDelegationSession({proposalSession:proposal,workflowSession:{execute:async()=>result}});
  await assert.rejects(()=>session.execute(workflow),/execution result must contain enumerable data fields only/);
  assert.equal(getterCalls,0);assert.equal(adopts,0);
});

test('delegation apply rejects accessor options before consuming pending workflow bytes',async()=>{
  const graph=createGraph('Apply boundary');
  const router=new ModelRouter().register({id:'image',operations:['generate-image'],invoke:async()=>({artifact:{name:'Frame.png',mimeType:'image/png'},payload:new Uint8Array([9])})});
  let applies=0;let getterCalls=0;
  const proposal=new AgentProposalSession({provider:noopProvider(),getGraph:()=>graph,commit:async()=>{applies++;}});
  const session=new AgentDelegationSession({proposalSession:proposal,workflowSession:new AgentWorkflowSession({router,getGraph:()=>graph})});
  const plan=createAgentPlan(graph,{intent:'generate',providerId:'mock',operations:[]});
  await session.execute(createAgentWorkflow(plan,[{id:'g',kind:'generate-media',payload:{operation:'generate-image'}}]));
  const options={};Object.defineProperty(options,'metadata',{enumerable:true,get(){getterCalls++;return{};}});
  await assert.rejects(()=>session.apply(options),/apply options must contain enumerable data fields only/);
  assert.equal(getterCalls,0);assert.equal(applies,0);assert.equal(session.snapshot().workflow.assetWriteCount,1);
});

test('delegation executes workflow into review without committing generated bytes', async()=>{
  let graph=createGraph('Film');let commits=0;
  const router=new ModelRouter().register({id:'image',operations:['generate-image'],invoke:async()=>({artifact:{name:'Frame.png',mimeType:'image/png'},payload:new Uint8Array([1,2,3])})});
  const proposal=new AgentProposalSession({provider:noopProvider(),getGraph:()=>graph,commit:async()=>{commits++;}});
  const execution=new AgentWorkflowSession({router,getGraph:()=>graph});
  const session=new AgentDelegationSession({proposalSession:proposal,workflowSession:execution});
  const plan=createAgentPlan(graph,{intent:'generate frame',providerId:'mock',operations:[]});
  const workflow=createAgentWorkflow(plan,[{id:'generate',kind:'generate-media',payload:{operation:'generate-image'}}]);
  const state=await session.execute(workflow);
  assert.equal(state.status,'pending');assert.equal(state.workflow.assetWriteCount,1);assert.deepEqual(state.workflow.tasks.map(({kind,status})=>({kind,status})),[{kind:'generate-media',status:'complete'}]);assert.equal(commits,0);assert.equal(Object.values(graph.nodes).some(n=>n.kind==='asset'),false);
});

test('delegation apply commits reviewed operations and matching generated asset bytes atomically', async()=>{
  let graph=createGraph('Film');let commitOptions;
  const router=new ModelRouter().register({id:'image',operations:['generate-image'],invoke:async()=>({artifact:{name:'Frame.png',mimeType:'image/png'},payload:new Uint8Array([1,2])})});
  const proposal=new AgentProposalSession({provider:noopProvider(),getGraph:()=>graph,commit:async(label,operations,metadata,options)=>{commitOptions=options;graph=applyTransaction(graph,{id:'tx',label,operations,metadata,createdAt:'now'});}});
  const session=new AgentDelegationSession({proposalSession:proposal,workflowSession:new AgentWorkflowSession({router,getGraph:()=>graph})});
  const plan=createAgentPlan(graph,{intent:'generate frame',providerId:'mock',operations:[]});
  const workflow=createAgentWorkflow(plan,[{id:'generate',kind:'generate-media',payload:{operation:'generate-image'}}]);
  await session.execute(workflow);await session.apply();
  const asset=Object.values(graph.nodes).find(n=>n.kind==='asset');assert.ok(asset);assert.deepEqual(commitOptions.persistContext.assetWrites.map(w=>w.assetId),[asset.id]);assert.equal(session.snapshot().status,'idle');
});

test('delegation discard drops pending payloads without graph mutation', async()=>{
  const graph=createGraph('Film');
  const router=new ModelRouter().register({id:'image',operations:['generate-image'],invoke:async()=>({artifact:{name:'Frame.png',mimeType:'image/png'},payload:new Uint8Array([1])})});
  const proposal=new AgentProposalSession({provider:noopProvider(),getGraph:()=>graph,commit:async()=>{throw new Error('must not commit');}});
  const session=new AgentDelegationSession({proposalSession:proposal,workflowSession:new AgentWorkflowSession({router,getGraph:()=>graph})});
  const plan=createAgentPlan(graph,{intent:'generate',providerId:'mock',operations:[]});const workflow=createAgentWorkflow(plan,[{id:'g',kind:'generate-media',payload:{operation:'generate-image'}}]);
  await session.execute(workflow);const dropped=session.discard();assert.equal(dropped.workflow.persistContext.assetWrites.length,1);assert.equal(session.snapshot().status,'idle');assert.equal(Object.values(graph.nodes).some(n=>n.kind==='asset'),false);
});

test('delegation keeps workflow payloads pending when durable apply fails so retry is possible', async()=>{
  const graph=createGraph('Film');let attempts=0;
  const router=new ModelRouter().register({id:'image',operations:['generate-image'],invoke:async()=>({artifact:{name:'Frame.png',mimeType:'image/png'},payload:new Uint8Array([1])})});
  const proposal=new AgentProposalSession({provider:noopProvider(),getGraph:()=>graph,commit:async()=>{attempts++;throw new Error('quota');}});
  const session=new AgentDelegationSession({proposalSession:proposal,workflowSession:new AgentWorkflowSession({router,getGraph:()=>graph})});
  const plan=createAgentPlan(graph,{intent:'generate',providerId:'mock',operations:[]});const workflow=createAgentWorkflow(plan,[{id:'g',kind:'generate-media',payload:{operation:'generate-image'}}]);
  await session.execute(workflow);await assert.rejects(()=>session.apply(),/quota/);assert.equal(attempts,1);assert.equal(session.snapshot().status,'pending');assert.equal(session.snapshot().workflow.assetWriteCount,1);
});
