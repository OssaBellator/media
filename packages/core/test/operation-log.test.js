import test from 'node:test';
import assert from 'node:assert/strict';
import {appendOperationLog,canonicalOperationLogJson,createOperationLog,operationLogChecksum,operationLogHead,replayOperationLog,truncateOperationLog,validateOperationLog} from '../src/operation-log.js';

const tx=(id,value)=>({id,label:`Add ${value}`,operations:[{type:'add',value}],metadata:{source:'test'}});
test('canonical JSON and checksum ignore object insertion order',()=>{const a={z:1,a:{y:2,x:3}},b={a:{x:3,y:2},z:1};assert.equal(canonicalOperationLogJson(a),canonicalOperationLogJson(b));assert.equal(operationLogChecksum(a),operationLogChecksum(b));});
test('append creates an immutable monotonic checksum chain',()=>{const empty=createOperationLog({projectId:'p',metadata:{name:'Demo'}}),one=appendOperationLog(empty,tx('t1',2)),two=appendOperationLog(one,tx('t2',3));assert.equal(empty.entries.length,0);assert.equal(one.entries[0].sequence,1);assert.equal(two.entries[1].sequence,2);assert.equal(two.entries[1].previousChecksum,two.entries[0].checksum);assert.deepEqual(operationLogHead(two),{sequence:2,checksum:two.entries[1].checksum,transactionId:'t2'});validateOperationLog(two);});
test('tampering is detected before replay',()=>{const log=appendOperationLog(createOperationLog({projectId:'p'}),tx('t1',2)),tampered=structuredClone(log);tampered.entries[0].transaction.operations[0].value=999;assert.throws(()=>validateOperationLog(tampered),/checksum mismatch/);});
test('sequence gaps and broken previous checksums are rejected',()=>{const log=appendOperationLog(appendOperationLog(createOperationLog({projectId:'p'}),tx('t1',1)),tx('t2',2)),gap=structuredClone(log),broken=structuredClone(log);gap.entries[1].sequence=3;broken.entries[1].previousChecksum='bad';assert.throws(()=>validateOperationLog(gap),/sequence gap/);assert.throws(()=>validateOperationLog(broken),/chain mismatch/);});
test('replay applies validated transactions in order',()=>{let log=createOperationLog({projectId:'p'});log=appendOperationLog(log,tx('t1',2));log=appendOperationLog(log,tx('t2',3));const result=replayOperationLog(10,log,(state,transaction)=>state+transaction.operations.reduce((sum,op)=>sum+op.value,0));assert.equal(result,15);});
test('truncate produces a valid recovery prefix that can branch',()=>{let log=createOperationLog({projectId:'p'});log=appendOperationLog(log,tx('t1',1));log=appendOperationLog(log,tx('t2',2));const prefix=truncateOperationLog(log,1),branch=appendOperationLog(prefix,tx('t3',7));assert.equal(branch.entries.length,2);assert.equal(branch.entries[1].sequence,2);assert.equal(branch.entries[1].previousChecksum,branch.entries[0].checksum);validateOperationLog(branch);});
test('non-JSON values are rejected instead of being silently normalized',()=>{const log=createOperationLog({projectId:'p'});assert.throws(()=>appendOperationLog(log,{id:'t',label:'bad',operations:[{value:NaN}],metadata:{}}),/finite numbers/);assert.throws(()=>appendOperationLog(log,{id:'t',label:'bad',operations:[],metadata:{value:undefined}}),/undefined/);});

test('canonical operation-log JSON rejects accessors without executing them',()=>{
  let objectGetterCalls=0;
  const object={safe:true};
  Object.defineProperty(object,'secret',{enumerable:true,get(){objectGetterCalls+=1;return'unsafe';}});
  assert.throws(()=>canonicalOperationLogJson(object),/enumerable data properties only/);
  assert.equal(objectGetterCalls,0);

  let arrayGetterCalls=0;
  const array=[];
  Object.defineProperty(array,'0',{enumerable:true,get(){arrayGetterCalls+=1;return'unsafe';}});
  array.length=1;
  assert.throws(()=>canonicalOperationLogJson(array),/dense enumerable data arrays/);
  assert.equal(arrayGetterCalls,0);
});

test('operation-log public boundaries reject getter-bearing logs, transactions and options without execution',()=>{
  const log=createOperationLog({projectId:'p'});
  let transactionGetterCalls=0;
  const transaction={label:'Edit',operations:[],metadata:{}};
  Object.defineProperty(transaction,'id',{enumerable:true,get(){transactionGetterCalls+=1;return't';}});
  assert.throws(()=>appendOperationLog(log,transaction),/enumerable data properties only/);
  assert.equal(transactionGetterCalls,0);

  let logGetterCalls=0;
  const forged={projectId:'p',baseRevision:0,metadata:{},entries:[]};
  Object.defineProperty(forged,'schema',{enumerable:true,get(){logGetterCalls+=1;return'media.operation-log.v1';}});
  assert.throws(()=>validateOperationLog(forged),/enumerable data properties only/);
  assert.equal(logGetterCalls,0);

  let optionGetterCalls=0;
  const options={};
  Object.defineProperty(options,'projectId',{enumerable:true,get(){optionGetterCalls+=1;return'p';}});
  assert.throws(()=>createOperationLog(options),/enumerable data properties only/);
  assert.equal(optionGetterCalls,0);
});

test('operation-log normalization preserves __proto__ as inert data',()=>{
  const metadata=JSON.parse('{"__proto__":{"polluted":true}}');
  const log=createOperationLog({projectId:'p',metadata});
  assert.equal(Object.getPrototypeOf(log.metadata),Object.prototype);
  assert.deepEqual(log.metadata.__proto__,{polluted:true});
  assert.equal({}.polluted,undefined);
  assert.match(canonicalOperationLogJson(log.metadata),/"__proto__"/);
});
