function abortError(){const error=new Error('Adaptive operation aborted');error.name='AbortError';return error;}
export function adaptiveRequestKey(item={}){const range=item.byteRange?`${item.byteRange.offset}:${item.byteRange.length}`:'';return `${item.initialization?'init':'media'}|${item.sequence??''}|${item.partial?'p':'s'}|${item.url??''}|${range}`;}
export class SegmentDeliveryLedger{
  constructor(){this.records=new Map();}
  state(item){return this.records.get(adaptiveRequestKey(item))??null;}
  begin(item){const key=adaptiveRequestKey(item),prior=this.records.get(key);if(prior?.status==='delivered'||prior?.status==='inflight')return false;this.records.set(key,{key,status:'inflight',attempts:(prior?.attempts??0)+1,lastError:null});return true;}
  delivered(item,meta={}){const key=adaptiveRequestKey(item),prior=this.records.get(key)??{key,attempts:1};this.records.set(key,{...prior,...meta,status:'delivered',lastError:null});}
  failed(item,error){const key=adaptiveRequestKey(item),prior=this.records.get(key)??{key,attempts:1};this.records.set(key,{...prior,status:'failed',lastError:error?.message??String(error)});}
  hasDelivered(item){return this.records.get(adaptiveRequestKey(item))?.status==='delivered';}
  prune({minSequence=null,maxRecords=5000}={}){for(const [key,record] of this.records)if(minSequence!=null&&Number(record.sequence??Infinity)<Number(minSequence))this.records.delete(key);if(this.records.size>maxRecords){const entries=[...this.records.entries()];for(const [key] of entries.slice(0,this.records.size-maxRecords))this.records.delete(key);}}
  snapshot(){return[...this.records.values()].map((record)=>({...record}));}
}
export function retryDelayMs(attempt,{baseMs=250,maxMs=8000,jitter=.2,random=Math.random}={}){const raw=Math.min(maxMs,Math.max(0,baseMs)*2**Math.max(0,attempt-1)),spread=raw*Math.max(0,Math.min(1,jitter));return Math.max(0,Math.round(raw-spread+random()*spread*2));}
export async function withAdaptiveRetry(operation,{attempts=3,signal,sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms)),onRetry=()=>{},retryable=(error)=>error?.name!=='AbortError',...delayOptions}={}){let lastError;for(let attempt=1;attempt<=Math.max(1,attempts);attempt++){if(signal?.aborted)throw abortError();try{return await operation({attempt,signal});}catch(error){lastError=error;if(attempt>=attempts||!retryable(error))throw error;const delayMs=retryDelayMs(attempt,delayOptions);onRetry({attempt,error,delayMs});await sleep(delayMs);}}throw lastError;}
