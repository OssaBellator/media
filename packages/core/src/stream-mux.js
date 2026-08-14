import { createFragmentedMp4Init, createFragmentedMp4Segment } from './isobmff-mux.js';

function bytesOf(value){if(value instanceof Uint8Array)return value;if(value instanceof ArrayBuffer)return new Uint8Array(value);if(ArrayBuffer.isView(value))return new Uint8Array(value.buffer,value.byteOffset,value.byteLength);throw new Error('Mux payload must be binary');}
function concat(parts){const arrays=parts.filter(Boolean).map(bytesOf);const out=new Uint8Array(arrays.reduce((s,a)=>s+a.length,0));let o=0;for(const a of arrays){out.set(a,o);o+=a.length;}return out;}
function ascii(value){return new TextEncoder().encode(String(value));}
function u8(v){return new Uint8Array([Number(v)&255]);}
function u16(v){const o=new Uint8Array(2);new DataView(o.buffer).setUint16(0,Number(v),false);return o;}
function i16(v){const o=new Uint8Array(2);new DataView(o.buffer).setInt16(0,Number(v),false);return o;}
function u32(v){const o=new Uint8Array(4);new DataView(o.buffer).setUint32(0,Number(v)>>>0,false);return o;}
function f64(v){const o=new Uint8Array(8);new DataView(o.buffer).setFloat64(0,Number(v),false);return o;}
function idBytes(id){let n=BigInt(id),len=1;while(n>=(1n<<BigInt(len*8)))len++;const o=new Uint8Array(len);for(let i=len-1;i>=0;i--){o[i]=Number(n&255n);n>>=8n;}return o;}
function sizeVint(size){let n=BigInt(size);for(let len=1;len<=8;len++){if(n<=(1n<<BigInt(7*len))-2n){const o=new Uint8Array(len);for(let i=len-1;i>=0;i--){o[i]=Number(n&255n);n>>=8n;}o[0]|=1<<(8-len);return o;}}throw new Error('EBML size too large');}
function unknownSizeVint(length=8){const o=new Uint8Array(length).fill(0xff);o[0]=1<<(8-length)|((1<<(8-length))-1);return o;}
function vintValue(value){const n=Number(value);for(let len=1;len<=8;len++){const max=2**(7*len)-2;if(n>0&&n<=max){let x=BigInt(n);const o=new Uint8Array(len);for(let i=len-1;i>=0;i--){o[i]=Number(x&255n);x>>=8n;}o[0]|=1<<(8-len);return o;}}throw new Error('Invalid EBML vint');}
function element(id,payload){const body=bytesOf(payload);return concat([idBytes(id),sizeVint(body.length),body]);}
function uint(value){let n=BigInt(Math.max(0,Math.round(Number(value)||0))),len=1;while(n>=(1n<<BigInt(len*8)))len++;const o=new Uint8Array(len);for(let i=len-1;i>=0;i--){o[i]=Number(n&255n);n>>=8n;}return o;}
function codecId(track){const c=String(track.codec).toLowerCase();if(track.type==='video'){if(c.startsWith('vp8'))return'V_VP8';if(c.startsWith('vp09')||c.startsWith('vp9'))return'V_VP9';if(c.startsWith('av01')||c.startsWith('av1'))return'V_AV1';}if(track.type==='audio'){if(c.startsWith('opus'))return'A_OPUS';if(c.startsWith('vorbis'))return'A_VORBIS';}throw new Error(`Unsupported streaming WebM codec ${track.codec}`);}
function trackEntry(track,number){const config=track.config??{};const parts=[element(0xd7,uint(number)),element(0x73c5,uint(number)),element(0x83,uint(track.type==='video'?1:2)),element(0x86,ascii(codecId(track)))];if(config.description)parts.push(element(0x63a2,bytesOf(config.description)));if(track.type==='video')parts.push(element(0xe0,concat([element(0xb0,uint(config.width??config.codedWidth)),element(0xba,uint(config.height??config.codedHeight))])));else parts.push(element(0xe1,concat([element(0xb5,f64(config.sampleRate??48000)),element(0x9f,uint(config.channels??config.numberOfChannels??2))])));return element(0xae,concat(parts));}
function webmHeader(tracks,{timecodeScale=1_000_000}={}){const header=element(0x1a45dfa3,concat([element(0x4286,uint(1)),element(0x42f7,uint(1)),element(0x42f2,uint(4)),element(0x42f3,uint(8)),element(0x4282,ascii('webm')),element(0x4287,uint(4)),element(0x4285,uint(2))]));const info=element(0x1549a966,concat([element(0x2ad7b1,uint(timecodeScale)),element(0x4d80,ascii('Media')),element(0x5741,ascii('Media'))]));const trackMap=new Map(tracks.map((t,i)=>[t.id,i+1]));const trackBox=element(0x1654ae6b,concat(tracks.map((t,i)=>trackEntry(t,i+1))));return{bytes:concat([header,idBytes(0x18538067),unknownSizeVint(8),info,trackBox]),trackMap};}
function simpleBlock(sample,trackNumber,clusterTime){const tick=Math.round(Number(sample.timestamp??0)/1000);const relative=tick-clusterTime;if(relative<-32768||relative>32767)throw new Error('WebM relative block time exceeds int16');const flags=sample.keyframe||sample.type==='key'?0x80:0;const payload=bytesOf(sample.payload??sample.bytes);return element(0xa3,concat([vintValue(trackNumber),i16(relative),u8(flags),payload]));}

export class FragmentedMp4StreamWriter {
  constructor(plan,sink,{movieTimescale=1000,sequenceNumber=1,initWriter=createFragmentedMp4Init,segmentWriter=createFragmentedMp4Segment}={}){this.plan=plan;this.sink=sink;this.movieTimescale=movieTimescale;this.sequence=sequenceNumber;this.initWriter=initWriter;this.segmentWriter=segmentWriter;this.started=false;this.segments=0;this.bytesWritten=0;}
  async start(){if(this.started)return;const init=this.initWriter(this.plan,{movieTimescale:this.movieTimescale});await this.sink.write(init);this.bytesWritten+=init.byteLength;this.started=true;}
  async writeSegment(segmentPlan){await this.start();const bytes=this.segmentWriter(segmentPlan,{sequenceNumber:this.sequence++});await this.sink.write(bytes);this.bytesWritten+=bytes.byteLength;this.segments++;return{index:this.segments-1,byteLength:bytes.byteLength};}
  async close(){await this.sink.close?.();return{segments:this.segments,byteLength:this.bytesWritten};}
}

export class StreamingWebmWriter {
  constructor(tracks,sink,{timecodeScale=1_000_000,maxClusterMs=5000}={}){if(!tracks?.length)throw new Error('StreamingWebmWriter requires tracks');this.tracks=tracks;this.sink=sink;this.timecodeScale=timecodeScale;this.maxClusterMs=maxClusterMs;this.started=false;this.trackMap=null;this.cluster=null;this.byteLength=0;this.clusterCount=0;}
  async start(){if(this.started)return;const header=webmHeader(this.tracks,{timecodeScale:this.timecodeScale});this.trackMap=header.trackMap;await this.sink.write(header.bytes);this.byteLength+=header.bytes.byteLength;this.started=true;}
  async addSample(sample){await this.start();const number=this.trackMap.get(sample.trackId);if(!number)throw new Error(`Unknown WebM streaming track ${sample.trackId}`);const tick=Math.round(Number(sample.timestamp??0)/1000);const key=Boolean(sample.keyframe??sample.type==='key');if(!this.cluster||tick-this.cluster.timecode>30000||(key&&tick-this.cluster.timecode>=this.maxClusterMs))await this.flushCluster(tick);this.cluster.blocks.push(simpleBlock(sample,number,this.cluster.timecode));}
  async flushCluster(nextTimecode=null){if(this.cluster?.blocks.length){const bytes=element(0x1f43b675,concat([element(0xe7,uint(this.cluster.timecode)),...this.cluster.blocks]));await this.sink.write(bytes);this.byteLength+=bytes.byteLength;this.clusterCount++;}this.cluster=nextTimecode==null?null:{timecode:Math.max(0,Math.round(nextTimecode)),blocks:[]};}
  async close(){await this.flushCluster();await this.sink.close?.();return{clusters:this.clusterCount,byteLength:this.byteLength};}
}
