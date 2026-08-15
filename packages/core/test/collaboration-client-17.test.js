import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createGraph} from '../src/graph.js';
import {createOperationLog} from '../src/operation-log.js';
import {createTransaction} from '../src/operations.js';
import {createOperationBatch,signOperationBatch} from '../src/operation-batch.js';
import {COLLABORATION_WIRE_SCHEMA,parseCollaborationWireRequest,submitCollaborationWirePayload} from '../src/collaboration-wire.js';
import {CollaborationClientError,collaborationResultAction,submitCollaborationBatchHttp} from '../src/collaboration-client.js';
import {TrustRegistryError} from '../src/trust-registry.js';

async function fixture(requestId='client-1'){
  const graph=createGraph('Client');
  const log=createOperationLog({projectId:graph.projectId});
  const tx=createTransaction('Rename',[{type:'node.update',nodeId:graph.projectId,patch:{name:'Remote'}}]);
  const unsigned=createOperationBatch(log,[tx],{actorId:'alice',keyId:'k1',issuedAt:1000,nonce:requestId});
  const batch=await signOperationBatch(unsigned,{sign:async({bytes})=>createHmac('sha256','client').update(bytes).digest('hex')});
  return{graph,log,batch};
}
async function wireResponse(batch,log,{status='applied',requestId='client-1'}={}){
  const request={schema:COLLABORATION_WIRE_SCHEMA,type:'batch.submit',requestId,batch};
  const body=new TextEncoder().encode(JSON.stringify(request));
  return submitCollaborationWirePayload(body,{submit:async()=>({verified:true,committed:true,result:{status,safe:status==='applied',requiresResign:status!=='applied',head:{sequence:status==='applied'?1:0,checksum:status==='applied'?batch.entries[0].checksum:null,transactionId:status==='applied'?batch.entries[0].transaction.id:null},conflicts:status==='conflict'?[]:undefined},log:status==='applied'?{...log,entries:batch.entries}:log})});
}

test('HTTP client sends one bounded canonical request and parses an applied result',async()=>{
  const {batch,log}=await fixture();
  let calls=0,seen=null;
  const fetchImpl=async(endpoint,options)=>{
    calls++;
    assert.equal(endpoint,'/collab');
    assert.equal(options.method,'POST');
    assert.equal(options.headers.get('content-type'),'application/json');
    assert.equal(options.headers.get('accept'),'application/json');
    seen=parseCollaborationWireRequest(options.body);
    const wire=await wireResponse(batch,log);
    return new Response(wire.body,{status:wire.statusCode,headers:{'content-type':'application/json'}});
  };
  const result=await submitCollaborationBatchHttp(batch,{requestId:'client-1',endpoint:'/collab',fetchImpl});
  assert.equal(calls,1);
  assert.equal(seen.requestId,'client-1');
  assert.equal(seen.batch.signature,batch.signature);
  assert.equal(result.status,'applied');
  assert.equal(result.head.sequence,1);
});

test('HTTP client exposes typed replay errors from bounded wire responses',async()=>{
  const {batch}=await fixture('client-replay');
  const fetchImpl=async()=>{
    const request={schema:COLLABORATION_WIRE_SCHEMA,type:'batch.submit',requestId:'client-replay',batch};
    const wire=await submitCollaborationWirePayload(JSON.stringify(request),{submit:async()=>{throw new TrustRegistryError('internal actor detail',{code:'ERR_TRUST_REPLAY'});}});
    return new Response(wire.body,{status:wire.statusCode,headers:{'content-type':'application/json'}});
  };
  await assert.rejects(()=>submitCollaborationBatchHttp(batch,{requestId:'client-replay',fetchImpl}),error=>error instanceof CollaborationClientError&&error.code==='replay-rejected'&&error.statusCode===409&&!error.message.includes('actor'));
});

test('HTTP client rejects mismatched request IDs and invalid response content type',async()=>{
  const {batch,log}=await fixture('client-match');
  const mismatch=async()=>{const wire=await wireResponse(batch,log,{requestId:'other'});return new Response(wire.body,{status:200,headers:{'content-type':'application/json'}});};
  await assert.rejects(()=>submitCollaborationBatchHttp(batch,{requestId:'client-match',fetchImpl:mismatch}),error=>error.code==='response-mismatch');
  const wrongType=async()=>new Response('nope',{status:200,headers:{'content-type':'text/plain'}});
  await assert.rejects(()=>submitCollaborationBatchHttp(batch,{requestId:'client-match',fetchImpl:wrongType}),error=>error.code==='invalid-response-content-type');
});

test('HTTP client enforces a streamed response byte ceiling',async()=>{
  const {batch}=await fixture('client-large');
  const body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(12));controller.enqueue(new Uint8Array(12));controller.close();}});
  const fetchImpl=async()=>new Response(body,{status:200,headers:{'content-type':'application/json'}});
  await assert.rejects(()=>submitCollaborationBatchHttp(batch,{requestId:'client-large',fetchImpl,maxResponseBytes:16}),error=>error.code==='response-too-large');
});


test('HTTP client accepts generic pre-parse server errors with no request ID',async()=>{
  const {batch}=await fixture('client-generic-error');
  const body=JSON.stringify({schema:COLLABORATION_WIRE_SCHEMA,type:'error',requestId:null,code:'ERR_COLLABORATION_WIRE_TOO_LARGE',message:'Collaboration request exceeds byte limit'});
  const fetchImpl=async()=>new Response(body,{status:413,headers:{'content-type':'application/json'}});
  await assert.rejects(()=>submitCollaborationBatchHttp(batch,{requestId:'client-generic-error',fetchImpl}),error=>error.code==='ERR_COLLABORATION_WIRE_TOO_LARGE'&&error.statusCode===413);
});

test('HTTP client never automatically retries an ambiguous network failure',async()=>{
  const {batch}=await fixture('client-network');
  let calls=0;
  const fetchImpl=async()=>{calls++;throw new Error('connection reset after upload');};
  await assert.rejects(()=>submitCollaborationBatchHttp(batch,{requestId:'client-network',fetchImpl}),error=>error.code==='network-failure');
  assert.equal(calls,1);
});

test('client resolution action maps server statuses without rewriting signed history',()=>{
  const base={type:'batch.result',conflicts:[]};
  assert.deepEqual(collaborationResultAction({...base,status:'applied'}),{action:'accepted',requiresResign:false,requiresRefresh:false,conflicts:[]});
  assert.equal(collaborationResultAction({...base,status:'rebase-safe'}).action,'resign');
  const conflict={resources:[]};
  assert.deepEqual(collaborationResultAction({...base,status:'conflict',conflicts:[conflict]}).conflicts,[conflict]);
  assert.equal(collaborationResultAction({...base,status:'different-history'}).action,'refresh');
});
