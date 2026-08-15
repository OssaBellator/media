function bytesOf(value){
  if(value instanceof Uint8Array)return value;
  if(value instanceof ArrayBuffer)return new Uint8Array(value);
  if(ArrayBuffer.isView(value))return new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
  throw new Error('CMAF fragment stream requires binary chunks');
}
function ascii(bytes,offset,length){let out='';for(let i=0;i<length;i++)out+=String.fromCharCode(bytes[offset+i]);return out;}
function boxHeader(bytes,offset,{final=false,maxBoxBytes}={}){
  const remaining=bytes.byteLength-offset;
  if(remaining<8)return null;
  const view=new DataView(bytes.buffer,bytes.byteOffset+offset,remaining);
  let size=view.getUint32(0,false),headerSize=8;
  const type=ascii(bytes,offset+4,4);
  if(size===1){
    if(remaining<16)return null;
    const high=view.getUint32(8,false),low=view.getUint32(12,false);
    const value=(BigInt(high)<<32n)|BigInt(low);
    if(value>BigInt(Number.MAX_SAFE_INTEGER))throw new Error(`CMAF box ${type} exceeds safe integer range`);
    size=Number(value);headerSize=16;
  }else if(size===0){
    if(!final)return null;
    size=remaining;
  }
  if(size<headerSize)throw new Error(`Invalid CMAF box ${type} size ${size}`);
  if(size>maxBoxBytes)throw new Error(`CMAF box ${type} exceeds ${maxBoxBytes} byte limit`);
  if(size>remaining)return null;
  return{type,offset,size,headerSize,end:offset+size};
}
export class CmafFragmentAssembler{
  constructor({id='cmaf-fragment-stream',maxBufferBytes=64*1024*1024,maxBoxBytes=maxBufferBytes}={}){
    this.id=String(id);
    this.maxBufferBytes=Math.max(1024,Number(maxBufferBytes)||64*1024*1024);
    this.maxBoxBytes=Math.max(8,Math.min(this.maxBufferBytes,Number(maxBoxBytes)||this.maxBufferBytes));
    this.buffer=new Uint8Array();
    this.scanOffset=0;
    this.fragmentStart=0;
    this.hasMoof=false;
    this.sequence=0;
    this.closed=false;
    this.metrics={chunks:0,bytesAppended:0,fragments:0,bytesEmitted:0};
  }
  append(value){
    if(this.closed)throw new Error('Cannot append to a closed CMAF fragment stream');
    const input=bytesOf(value);
    if(input.byteLength){
      if(this.buffer.byteLength+input.byteLength>this.maxBufferBytes)throw new Error(`CMAF fragment stream exceeds ${this.maxBufferBytes} byte buffer limit`);
      const next=new Uint8Array(this.buffer.byteLength+input.byteLength);
      next.set(this.buffer);next.set(input,this.buffer.byteLength);this.buffer=next;
      this.metrics.chunks++;this.metrics.bytesAppended+=input.byteLength;
    }
    return this.#drain(false);
  }
  close(){
    if(this.closed)return[];
    const emitted=this.#drain(true);
    if(this.buffer.byteLength)throw new Error(`CMAF fragment stream ended with ${this.buffer.byteLength} incomplete byte${this.buffer.byteLength===1?'':'s'}`);
    this.closed=true;
    return emitted;
  }
  stats(){return{...this.metrics,id:this.id,bufferedBytes:this.buffer.byteLength,closed:this.closed};}
  #drain(final){
    const emitted=[];
    while(true){
      const box=boxHeader(this.buffer,this.scanOffset,{final,maxBoxBytes:this.maxBoxBytes});
      if(!box)break;
      if(box.type==='moof'){
        if(this.hasMoof)throw new Error('CMAF fragment stream encountered a second moof before mdat');
        this.hasMoof=true;
      }
      this.scanOffset=box.end;
      if(box.type==='mdat'&&this.hasMoof){
        const bytes=this.buffer.slice(this.fragmentStart,box.end),record={id:`${this.id}:${this.sequence}`,index:this.sequence++,bytes,byteLength:bytes.byteLength};
        emitted.push(record);this.metrics.fragments++;this.metrics.bytesEmitted+=bytes.byteLength;
        this.buffer=this.buffer.slice(box.end);
        this.scanOffset=0;this.fragmentStart=0;this.hasMoof=false;
      }
    }
    if(final&&this.scanOffset===this.buffer.byteLength&&!this.hasMoof&&this.buffer.byteLength){
      // Complete non-fragment prefix/trailer boxes are not useful without a moof+mdat unit.
      this.buffer=new Uint8Array();this.scanOffset=0;this.fragmentStart=0;
    }
    return emitted;
  }
}
