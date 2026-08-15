import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createGraph} from '../src/graph.js';
import {createOperationLog} from '../src/operation-log.js';
import {createTransaction} from '../src/operations.js';
import {createOperationBatch,signOperationBatch} from '../src/operation-batch.js';
import {createCollaborationSubmitRequest,encodeCollaborationWireRequest} from '../src/collaboration-wire.js';
import {createCollaborationHttpHandler,DEFAULT_COLLABORATION_HTTP_PATH} from '../src/collaboration-http.js';

async function fixture(requestId='http-1'){
  const graph=createGraph('HTTP');
  const log=createOperationLog({projectId:graph.projectId});
  const tx=createTransaction('Rename',[{type:'node.update',nodeId:graph.projectId,patch:{name:'Remote'}}]);
  const unsigned=createOperationBatch(log,[tx],{actorId:'alice',keyId:'k1',issuedAt:1000,nonce:requestId});
  const batch=await signOperationBatch(unsigned,{sign:async({bytes})=>createHmac('sha256','http').update(bytes).digest('hex')});
  const bytes=encodeCollaborationWireRequest(createCollaborationSubmitRequest(batch,{requestId}));
  return{graph,log,batch,bytes};
}
function url(path=DEFAULT_COLLABORATION_HTTP_PATH){return `https://media.invalid${path}`;}

test('HTTP adapter rejects route, method and media type before submission',async()=>{
  let submits=0;
  const handler=createCollaborationHttpHandler({submit:async()=>{submits++;}});
  assert.equal((await handler(new Request(url('/other'),{method:'POST',headers:{'content-type':'application/json'},body:'{}'}))).status,404);
  const method=await handler(new Request(url(),{method:'GET'}));
  assert.equal(method.status,405);
  assert.equal(method.headers.get('allow'),'POST');
  assert.equal((await handler(new Request(url(),{method:'POST',headers:{'content-type':'text/plain'},body:'{}'}))).status,415);
  assert.equal(submits,0);
});

test('HTTP adapter rejects cross-origin and unauthorized requests before pulling body bytes',async()=>{
  let pulls=0,authCalls=0;
  const stream=()=>new ReadableStream({pull(controller){pulls++;controller.enqueue(new TextEncoder().encode('{}'));controller.close();}},{highWaterMark:0});
  const handler=createCollaborationHttpHandler({submit:async()=>{throw new Error('should not submit');},authorizeRequest:async()=>{authCalls++;return false;}});
  const cross=new Request(url(),{method:'POST',headers:{'content-type':'application/json','origin':'https://evil.invalid'},body:stream(),duplex:'half'});
  assert.equal((await handler(cross)).status,403);
  assert.equal(authCalls,0);
  assert.equal(pulls,0);
  const unauthorized=new Request(url(),{method:'POST',headers:{'content-type':'application/json'},body:stream(),duplex:'half'});
  assert.equal((await handler(unauthorized)).status,401);
  assert.equal(authCalls,1);
  assert.equal(pulls,0);
});

test('HTTP adapter stream-reads request bodies with a hard byte ceiling',async()=>{
  let submits=0;
  const handler=createCollaborationHttpHandler({maxBodyBytes:8,submit:async()=>{submits++;}});
  const body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(6));controller.enqueue(new Uint8Array(6));controller.close();}});
  const response=await handler(new Request(url(),{method:'POST',headers:{'content-type':'application/json'},body,duplex:'half'}));
  assert.equal(response.status,413);
  assert.equal(submits,0);
  assert.equal((await response.json()).code,'request-too-large');
});

test('HTTP adapter delegates a valid bounded request to the wire submit path',async()=>{
  const {bytes,batch,log}=await fixture();
  let submitted=null;
  const handler=createCollaborationHttpHandler({submit:async(value)=>{submitted=value;return{verified:true,committed:true,result:{status:'applied',safe:true,requiresResign:false,head:{sequence:1,checksum:batch.entries[0].checksum,transactionId:batch.entries[0].transaction.id}},log:{...log,entries:batch.entries}};}});
  const response=await handler(new Request(url(),{method:'POST',headers:{'content-type':'application/json; charset=utf-8'},body:bytes}));
  assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  const value=await response.json();
  assert.equal(value.status,'applied');
  assert.equal(value.requestId,'http-1');
  assert.equal(submitted.signature,batch.signature);
});

test('HTTP adapter handles explicit CORS preflight and allowed cross-origin POSTs',async()=>{
  const {bytes,batch,log}=await fixture('origin');
  let authCalls=0;
  const handler=createCollaborationHttpHandler({allowedOrigins:['https://app.invalid'],authorizeRequest:async()=>{authCalls++;return true;},submit:async()=>({verified:true,committed:true,result:{status:'applied',safe:true,head:{sequence:1,checksum:batch.entries[0].checksum,transactionId:batch.entries[0].transaction.id}},log:{...log,entries:batch.entries}})});
  const preflight=await handler(new Request(url(),{method:'OPTIONS',headers:{'origin':'https://app.invalid','access-control-request-method':'POST','access-control-request-headers':'content-type, authorization'}}));
  assert.equal(preflight.status,204);
  assert.equal(preflight.headers.get('access-control-allow-origin'),'https://app.invalid');
  assert.match(preflight.headers.get('access-control-allow-methods'),/POST/);
  assert.equal(authCalls,0);
  const response=await handler(new Request(url(),{method:'POST',headers:{'content-type':'application/json','origin':'https://app.invalid'},body:bytes}));
  assert.equal(response.status,200);
  assert.equal(response.headers.get('access-control-allow-origin'),'https://app.invalid');
  assert.equal(authCalls,1);
});

test('HTTP adapter rejects disallowed CORS preflight headers',async()=>{
  const handler=createCollaborationHttpHandler({allowedOrigins:['https://app.invalid'],submit:async()=>{throw new Error('should not submit');}});
  const response=await handler(new Request(url(),{method:'OPTIONS',headers:{'origin':'https://app.invalid','access-control-request-method':'POST','access-control-request-headers':'x-unexpected'}}));
  assert.equal(response.status,403);
  assert.equal((await response.json()).code,'preflight-rejected');
});

test('HTTP adapter converts unknown service failures to a generic 500 response',async()=>{
  const {bytes}=await fixture('failure');
  const handler=createCollaborationHttpHandler({submit:async()=>{throw new Error('postgres password=secret');}});
  const response=await handler(new Request(url(),{method:'POST',headers:{'content-type':'application/json'},body:bytes}));
  assert.equal(response.status,500);
  const value=await response.json();
  assert.equal(value.code,'internal-error');
  assert.equal(JSON.stringify(value).includes('postgres'),false);
  assert.equal(JSON.stringify(value).includes('secret'),false);
});
