import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createGraph} from '../src/graph.js';
import {createOperationLog} from '../src/operation-log.js';
import {createTransaction} from '../src/operations.js';
import {createOperationBatch,signOperationBatch} from '../src/operation-batch.js';
import {TrustRegistryError} from '../src/trust-registry.js';
import {COLLABORATION_WIRE_SCHEMA,createCollaborationSubmitRequest,encodeCollaborationWireRequest,parseCollaborationWireRequest,parseCollaborationWireResponse,submitCollaborationWirePayload} from '../src/collaboration-wire.js';

const secret='wire';
async function signedBatch(){
  const graph=createGraph('Wire');
  const log=createOperationLog({projectId:graph.projectId});
  const tx=createTransaction('Rename',[{type:'node.update',nodeId:graph.projectId,patch:{name:'Remote'}}]);
  const unsigned=createOperationBatch(log,[tx],{actorId:'alice',keyId:'k1',issuedAt:1000,nonce:'n1'});
  const batch=await signOperationBatch(unsigned,{sign:async({bytes})=>createHmac('sha256',secret).update(bytes).digest('hex')});
  return{graph,log,batch};
}

test('wire request round-trips deterministically with a bounded signed batch',async()=>{
  const {batch}=await signedBatch();
  const request=createCollaborationSubmitRequest(batch,{requestId:'req-1'});
  const bytes=encodeCollaborationWireRequest(request);
  assert.deepEqual(parseCollaborationWireRequest(bytes),request);
  assert.equal(JSON.parse(new TextDecoder().decode(bytes)).schema,COLLABORATION_WIRE_SCHEMA);
});

test('wire parser rejects oversized, unknown-field and malformed-batch envelopes',async()=>{
  const {batch}=await signedBatch();
  const request=createCollaborationSubmitRequest(batch,{requestId:'req-2'});
  assert.throws(()=>parseCollaborationWireRequest('x'.repeat(20),{maxBytes:10}),/byte limit/);
  assert.throws(()=>parseCollaborationWireRequest(JSON.stringify({...request,extra:true})),/Unsupported collaboration envelope field/);
  const bad=structuredClone(request);
  bad.batch.signature=null;
  assert.throws(()=>parseCollaborationWireRequest(JSON.stringify(bad)),/batch is malformed/);
});

test('wire submit returns transport-safe applied result and current head',async()=>{
  const {batch,log}=await signedBatch();
  const head={sequence:1,checksum:batch.entries[0].checksum,transactionId:batch.entries[0].transaction.id};
  const payload=encodeCollaborationWireRequest(createCollaborationSubmitRequest(batch,{requestId:'req-3'}));
  const response=await submitCollaborationWirePayload(payload,{submit:async()=>({
    verified:true,
    committed:true,
    result:{status:'applied',safe:true,requiresResign:false,head},
    log:{...log,entries:batch.entries},
  })});
  assert.equal(response.statusCode,200);
  assert.equal(response.response.status,'applied');
  assert.deepEqual(response.response.head,head);
  assert.equal(response.response.conflicts.length,0);
  assert.deepEqual(parseCollaborationWireResponse(response.body),response.response);
});

test('wire conflict response strips operation bodies and bounds conflict count',async()=>{
  const {batch,log}=await signedBatch();
  const conflict={
    localSequence:2,
    localTransactionId:'local',
    remoteSequence:1,
    remoteTransactionId:'remote',
    leftOperationIndex:0,
    rightOperationIndex:0,
    leftOperation:{secret:'local-body'},
    rightOperation:{secret:'remote-body'},
    resources:[{left:{scope:'node',id:'p',path:'props:x'},right:{scope:'node',id:'p',path:'props:x'}}],
  };
  const payload=encodeCollaborationWireRequest(createCollaborationSubmitRequest(batch,{requestId:'req-4'}));
  const result=await submitCollaborationWirePayload(payload,{
    maxConflicts:1,
    submit:async()=>({
      verified:true,
      committed:true,
      result:{status:'conflict',safe:false,requiresResign:true,conflicts:[conflict,{...conflict,localSequence:3}]},
      log,
    }),
  });
  assert.equal(result.response.status,'conflict');
  assert.equal(result.response.conflicts.length,1);
  assert.equal(result.response.conflictsTruncated,1);
  assert.equal('leftOperation' in result.response.conflicts[0],false);
  assert.equal(result.response.head.sequence,0);
});

test('wire maps signature rejection and replay policy without exposing verifier detail',async()=>{
  const {batch}=await signedBatch();
  const payload=encodeCollaborationWireRequest(createCollaborationSubmitRequest(batch,{requestId:'req-5'}));
  const unauthorized=await submitCollaborationWirePayload(payload,{submit:async()=>({verified:false,committed:false})});
  assert.equal(unauthorized.statusCode,401);
  assert.equal(unauthorized.response.code,'authentication-rejected');
  const replay=await submitCollaborationWirePayload(payload,{submit:async()=>{
    throw new TrustRegistryError('nonce alice secret already used',{code:'ERR_TRUST_REPLAY'});
  }});
  assert.equal(replay.statusCode,409);
  assert.equal(replay.response.code,'replay-rejected');
  assert.equal(replay.response.message.includes('alice'),false);
});

test('wire leaves unknown application/persistence failures to the hosting transport',async()=>{
  const {batch}=await signedBatch();
  const payload=encodeCollaborationWireRequest(createCollaborationSubmitRequest(batch,{requestId:'req-6'}));
  await assert.rejects(()=>submitCollaborationWirePayload(payload,{submit:async()=>{throw new Error('database down');}}),/database down/);
});


test('wire response parser rejects unknown fields and unsupported statuses',()=>{
  const base={schema:COLLABORATION_WIRE_SCHEMA,type:'batch.result',requestId:'response-1',status:'applied',verified:true,committed:true,requiresResign:false,safe:true,head:{sequence:0,checksum:null,transactionId:null},localEntries:0,remoteEntries:1,conflicts:[],conflictsTruncated:0};
  assert.throws(()=>parseCollaborationWireResponse(JSON.stringify({...base,unexpected:true})),/Unsupported collaboration envelope field/);
  assert.throws(()=>parseCollaborationWireResponse(JSON.stringify({...base,status:'mystery'})),/Unsupported collaboration result status/);
  assert.throws(()=>parseCollaborationWireResponse('x'.repeat(40),{maxBytes:10}),/byte limit/);
});
