export const OPERATION_LOG_SCHEMA='media.operation-log.v1';

function normalizeJsonValue(value,path='value',seen=new Set()){
  if(value===null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number'){if(!Number.isFinite(value))throw new Error(`${path} must contain only finite numbers`);return value;}
  if(typeof value!=='object')throw new Error(`${path} contains unsupported ${typeof value}`);
  if(seen.has(value))throw new Error(`${path} must not contain cycles`);
  seen.add(value);
  try{
    if(Array.isArray(value)){
      const keys=Reflect.ownKeys(value);
      for(const key of keys){if(key==='length')continue;if(typeof key!=='string'||!/^(0|[1-9]\d*)$/.test(key))throw new Error(`${path} arrays cannot contain custom properties`);}
      const output=new Array(value.length);
      for(let index=0;index<value.length;index++){
        const descriptor=Object.getOwnPropertyDescriptor(value,String(index));
        if(!descriptor?.enumerable||!Object.hasOwn(descriptor,'value'))throw new Error(`${path} arrays must be dense enumerable data arrays`);
        if(descriptor.value===undefined)throw new Error(`${path}[${index}] must not be undefined`);
        output[index]=normalizeJsonValue(descriptor.value,`${path}[${index}]`,seen);
      }
      return output;
    }
    const proto=Object.getPrototypeOf(value);if(proto!==Object.prototype&&proto!==null)throw new Error(`${path} must contain only plain objects`);
    const descriptors=Object.getOwnPropertyDescriptors(value),output={};
    for(const key of Reflect.ownKeys(descriptors)){
      if(typeof key!=='string')throw new Error(`${path} objects cannot contain symbol keys`);
      const descriptor=descriptors[key];
      if(!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))throw new Error(`${path} objects must contain enumerable data properties only`);
      if(descriptor.value===undefined)throw new Error(`${path}.${key} must not be undefined`);
      Object.defineProperty(output,key,{value:normalizeJsonValue(descriptor.value,`${path}.${key}`,seen),enumerable:true,writable:true,configurable:true});
    }
    return output;
  }finally{seen.delete(value);}
}
function canonical(value){
  if(value===null)return'null';
  if(typeof value==='string'||typeof value==='boolean'||typeof value==='number')return JSON.stringify(value);
  if(Array.isArray(value))return`[${value.map(canonical).join(',')}]`;
  return`{${Object.keys(value).sort().map((key)=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
export function canonicalOperationLogJson(value){return canonical(normalizeJsonValue(value));}
export function operationLogChecksum(value){const text=canonicalOperationLogJson(value);let hash=0xcbf29ce484222325n;for(let i=0;i<text.length;i++){const code=text.charCodeAt(i);hash^=BigInt(code&255);hash=BigInt.asUintN(64,hash*0x100000001b3n);hash^=BigInt(code>>>8);hash=BigInt.asUintN(64,hash*0x100000001b3n);}return hash.toString(16).padStart(16,'0');}
function cloneJson(value,path='value'){return normalizeJsonValue(value,path);}
function normalizeTransaction(transaction){const clean=normalizeJsonValue(transaction,'transaction');if(!clean||typeof clean!=='object'||Array.isArray(clean))throw new Error('Operation-log transaction must be an object');if(typeof clean.id!=='string'||!clean.id)throw new Error('Operation-log transaction id is required');if(typeof clean.label!=='string'||!clean.label)throw new Error('Operation-log transaction label is required');if(!Array.isArray(clean.operations))throw new Error('Operation-log transaction operations must be an array');return clean;}
function entryPayload({sequence,transaction,previousChecksum}){return{schema:OPERATION_LOG_SCHEMA,sequence,transaction,previousChecksum};}
function normalizeOperationLog(log){
  const clean=normalizeJsonValue(log,'Operation log');
  if(!clean||typeof clean!=='object'||Array.isArray(clean))throw new Error('Operation log must be an object');
  if(clean.schema!==OPERATION_LOG_SCHEMA)throw new Error(`Unsupported operation-log schema: ${clean.schema}`);
  if(typeof clean.projectId!=='string'||!clean.projectId)throw new Error('Operation log projectId is required');
  if(!Number.isSafeInteger(clean.baseRevision)||clean.baseRevision<0)throw new Error('Operation log baseRevision is invalid');
  if(!Array.isArray(clean.entries))throw new Error('Operation log entries must be an array');
  if(clean.metadata!==undefined)normalizeJsonValue(clean.metadata,'metadata');
  let previousChecksum=null;
  for(let index=0;index<clean.entries.length;index++){
    const entry=clean.entries[index],sequence=index+1;
    if(!entry||typeof entry!=='object'||Array.isArray(entry))throw new Error(`Operation log entry ${sequence} must be an object`);
    if(entry.schema!==OPERATION_LOG_SCHEMA)throw new Error(`Operation log entry ${sequence} schema mismatch`);
    if(entry.sequence!==sequence)throw new Error(`Operation log sequence gap at ${sequence}`);
    const transaction=normalizeTransaction(entry.transaction);
    if((entry.previousChecksum??null)!==previousChecksum)throw new Error(`Operation log checksum chain mismatch at ${sequence}`);
    const expected=operationLogChecksum(entryPayload({sequence,transaction,previousChecksum}));
    if(entry.checksum!==expected)throw new Error(`Operation log checksum mismatch at ${sequence}`);
    previousChecksum=entry.checksum;
  }
  return clean;
}
export function createOperationLog(options={}){
  const clean=normalizeJsonValue(options,'Operation log options');
  if(!clean||typeof clean!=='object'||Array.isArray(clean))throw new Error('Operation log options must be an object');
  const projectId=clean.projectId,baseRevision=clean.baseRevision??0,metadata=clean.metadata??{};
  if(typeof projectId!=='string'||!projectId)throw new Error('Operation log projectId is required');
  if(!Number.isSafeInteger(baseRevision)||baseRevision<0)throw new Error('Operation log baseRevision must be a non-negative safe integer');
  return{schema:OPERATION_LOG_SCHEMA,projectId,baseRevision,metadata:cloneJson(metadata,'metadata'),entries:[]};
}
export function validateOperationLog(log){normalizeOperationLog(log);return log;}
export function appendOperationLog(log,transaction){const cleanLog=normalizeOperationLog(log),cleanTransaction=normalizeTransaction(transaction),sequence=cleanLog.entries.length+1,previousChecksum=cleanLog.entries.at(-1)?.checksum??null,payload=entryPayload({sequence,transaction:cleanTransaction,previousChecksum}),entry={...payload,checksum:operationLogChecksum(payload)};return{...cleanLog,metadata:cloneJson(cleanLog.metadata??{},'metadata'),entries:[...cleanLog.entries,entry]};}
export function operationLogHead(log){const clean=normalizeOperationLog(log),entry=clean.entries.at(-1)??null;return{sequence:entry?.sequence??0,checksum:entry?.checksum??null,transactionId:entry?.transaction?.id??null};}
export function truncateOperationLog(log,sequence){const clean=normalizeOperationLog(log);if(!Number.isSafeInteger(sequence)||sequence<0||sequence>clean.entries.length)throw new Error('Operation-log truncate sequence is out of range');const next={...clean,metadata:cloneJson(clean.metadata??{},'metadata'),entries:clean.entries.slice(0,sequence)};normalizeOperationLog(next);return next;}
export function replayOperationLog(baseState,log,applyTransaction){const clean=normalizeOperationLog(log);if(typeof applyTransaction!=='function')throw new Error('Operation-log replay requires applyTransaction');let state=baseState;for(const entry of clean.entries)state=applyTransaction(state,cloneJson(entry.transaction,'transaction'),entry);return state;}
