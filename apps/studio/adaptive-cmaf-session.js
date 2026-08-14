import { AdaptiveStreamSession } from './adaptive-stream-session.js';
export class AdaptiveContainerError extends Error{constructor(message,{url=null}={}){super(message);this.name='AdaptiveContainerError';this.code='ERR_ADAPTIVE_CONTAINER_UNSUPPORTED';this.url=url;}}
async function defaultCmafFactory(init,{maxSegments}){const {CmafSegmentSession}=await import('../../packages/core/src/cmaf-session.js');return new CmafSegmentSession(init,{maxSegments});}
function looksMpegTs(url=''){return /\.m?ts(?:$|[?#])/i.test(String(url));}
export class AdaptiveCmafSession{
  constructor({manifestUrl,fetchImpl=globalThis.fetch,maxSegments=8,cmafFactory=defaultCmafFactory,onIndexedSegment=()=>{},onVariant=()=>{},...streamOptions}={}){this.maxSegments=Math.max(1,maxSegments);this.cmafFactory=cmafFactory;this.onIndexedSegment=onIndexedSegment;this.currentInit=null;this.currentInitKey=null;this.cmaf=null;this.indexed=new Map();this.variant=null;this.stream=new AdaptiveStreamSession({manifestUrl,fetchImpl,...streamOptions,onVariant:(variant)=>{this.variant=variant;onVariant(variant);},onSegment:(payload)=>this.#accept(payload)});}
  async open(options){return this.stream.open(options);}
  async pumpOnce(options){return this.stream.pumpOnce(options);}
  async refresh(options){return this.stream.refresh(options);}
  snapshot(){return{...this.stream.snapshot(),cmaf:this.cmaf?.stats?.()??null,indexedSegments:this.indexed.size,initKey:this.currentInitKey};}
  async #accept({segment,bytes,variant,manifest,state}){if(segment.initialization){const key=`${variant?.id??'hls'}:${segment.url}`;if(key!==this.currentInitKey){this.currentInit=bytes.slice();this.currentInitKey=key;this.cmaf=await this.cmafFactory(this.currentInit,{maxSegments:this.maxSegments,variant,manifest});this.indexed.clear();}return;}if(looksMpegTs(segment.url))throw new AdaptiveContainerError('MPEG-TS adaptive segments are not supported by the Media kernel',{url:segment.url});if(!this.cmaf){const map=segment.map;if(!map?.url)throw new AdaptiveContainerError('CMAF adaptive media requires an initialization segment',{url:segment.url});throw new Error('CMAF initialization segment has not been delivered yet');}const record=await this.cmaf.push(bytes,{id:segment.id});this.indexed.set(segment.id,{segment,record});await this.onIndexedSegment({segment,record,variant,manifest,state,session:this});return record;}
  acknowledge(segmentId){const ok=this.cmaf?.acknowledge?.(segmentId)??false;if(ok)this.indexed.delete(String(segmentId));return ok;}
  async readChunk(chunk){if(!this.cmaf)throw new Error('CMAF session is not initialized');return this.cmaf.readChunk(chunk);}
  stop(){this.stream.stop();this.cmaf?.clear?.();this.indexed.clear();}
}
