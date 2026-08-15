const SAMPLE_RATES=[96000,88200,64000,48000,44100,32000,24000,22050,16000,12000,11025,8000,7350];
function concat(a,b){const out=new Uint8Array(a.length+b.length);out.set(a);out.set(b,a.length);return out;}
export function audioSpecificConfig(objectType,sampleRateIndex,channels){const a=(objectType<<3)|(sampleRateIndex>>1),b=((sampleRateIndex&1)<<7)|(channels<<3);return new Uint8Array([a,b]);}
export function parseAdtsHeader(data,offset=0){
  if(offset+7>data.length||data[offset]!==0xff||(data[offset+1]&0xf6)!==0xf0)return null;
  const protectionAbsent=data[offset+1]&1,profile=(data[offset+2]>>6)&3,rateIndex=(data[offset+2]>>2)&15,channels=((data[offset+2]&1)<<2)|((data[offset+3]>>6)&3),frameLength=((data[offset+3]&3)<<11)|(data[offset+4]<<3)|(data[offset+5]>>5),headerLength=protectionAbsent?7:9,sampleRate=SAMPLE_RATES[rateIndex]??null;
  if(!sampleRate||frameLength<headerLength)return null;
  const objectType=profile+1;return{profile,objectType,rateIndex,sampleRate,channels,frameLength,headerLength,codec:`mp4a.40.${objectType}`,description:audioSpecificConfig(objectType,rateIndex,channels)};
}
export class AdtsFrameAssembler{
  constructor(){this.pending=new Uint8Array();this.frameIndex=0;}
  reset(){this.pending=new Uint8Array();this.frameIndex=0;}
  push(bytes,{timestampMicros=null}={}){
    let data=concat(this.pending,bytes instanceof Uint8Array?bytes:new Uint8Array(bytes)),offset=0,base=timestampMicros,frames=[];
    while(offset+7<=data.length){if(data[offset]!==0xff||(data[offset+1]&0xf6)!==0xf0){offset++;continue;}const header=parseAdtsHeader(data,offset);if(!header){offset++;continue;}if(offset+header.frameLength>data.length)break;const durationMicros=Math.round(1024*1_000_000/header.sampleRate),timestamp=base==null?null:base+frames.length*durationMicros;frames.push({...header,timestamp,duration:durationMicros,data:data.slice(offset+header.headerLength,offset+header.frameLength),sequence:this.frameIndex++});offset+=header.frameLength;}
    this.pending=data.slice(offset);return frames;
  }
}
