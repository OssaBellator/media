function bytesOf(value){if(value instanceof Uint8Array)return value;if(value instanceof ArrayBuffer)return new Uint8Array(value);if(ArrayBuffer.isView(value))return new Uint8Array(value.buffer,value.byteOffset,value.byteLength);throw new Error('Byte sink accepts binary data only');}
export class MemoryByteSink {
  constructor(){this.parts=[];this.byteLength=0;this.closed=false;}
  async write(value){if(this.closed)throw new Error('Byte sink is closed');const bytes=bytesOf(value).slice();this.parts.push(bytes);this.byteLength+=bytes.byteLength;return this.byteLength;}
  async close(){this.closed=true;return this.bytes();}
  bytes(){const output=new Uint8Array(this.byteLength);let offset=0;for(const part of this.parts){output.set(part,offset);offset+=part.byteLength;}return output;}
}
export class CountingByteSink {
  constructor(inner=null){this.inner=inner;this.byteLength=0;this.writes=0;this.closed=false;}
  async write(value){if(this.closed)throw new Error('Byte sink is closed');const bytes=bytesOf(value);this.byteLength+=bytes.byteLength;this.writes++;if(this.inner)await this.inner.write(bytes);return this.byteLength;}
  async close(){if(this.closed)return;this.closed=true;return this.inner?.close?.();}
}
export function writableStreamByteSink(stream){
  if(!stream)throw new Error('Writable stream is required');
  const writer=typeof stream.getWriter==='function'?stream.getWriter():null;
  let closed=false;
  return {get closed(){return closed;},async write(value){if(closed)throw new Error('Byte sink is closed');const bytes=bytesOf(value);if(writer)await writer.write(bytes);else if(typeof stream.write==='function')await stream.write(bytes);else throw new Error('Writable target has no write method');},async close(){if(closed)return;closed=true;if(writer){await writer.close();writer.releaseLock?.();}else await stream.close?.();}};
}
export async function writeByteParts(sink,parts,{signal}={}){let total=0;for(const part of parts){if(signal?.aborted)throw new DOMException('Write aborted','AbortError');const bytes=bytesOf(part);await sink.write(bytes);total+=bytes.byteLength;}return total;}
