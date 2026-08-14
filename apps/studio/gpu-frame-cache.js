function dimensions(frame){const width=Number(frame?.displayWidth??frame?.codedWidth??frame?.width),height=Number(frame?.displayHeight??frame?.codedHeight??frame?.height);if(!(width>0&&height>0))throw new Error('GPU frame requires dimensions');return{width,height};}
export class GpuFrameTextureCache {
  constructor(device,{maxBytes=256*1024*1024,maxEntries=96,format='rgba8unorm'}={}){if(!device)throw new Error('GpuFrameTextureCache requires a GPUDevice');this.device=device;this.maxBytes=Math.max(4,Number(maxBytes)||0);this.maxEntries=Math.max(1,Math.round(Number(maxEntries)||1));this.format=format;this.map=new Map();this.bytes=0;this.clock=0;}
  has(key){return this.map.has(String(key));}
  get(key){const entry=this.map.get(String(key));if(!entry)return null;entry.used=++this.clock;return entry.texture;}
  textureForFrame(key,frame){const id=String(key);const existing=this.map.get(id);if(existing){existing.used=++this.clock;return existing.texture;}const {width,height}=dimensions(frame),byteLength=width*height*4;const usage=(globalThis.GPUTextureUsage?.TEXTURE_BINDING??4)|(globalThis.GPUTextureUsage?.COPY_DST??2)|(globalThis.GPUTextureUsage?.RENDER_ATTACHMENT??16);const texture=this.device.createTexture({size:{width,height,depthOrArrayLayers:1},format:this.format,usage});this.device.queue.copyExternalImageToTexture({source:frame},{texture},{width,height});this.map.set(id,{texture,width,height,byteLength,used:++this.clock});this.bytes+=byteLength;this.evict();return texture;}
  evict(){while(this.map.size>this.maxEntries||this.bytes>this.maxBytes){let oldestKey=null,oldest=Infinity;for(const [key,entry] of this.map)if(entry.used<oldest){oldest=entry.used;oldestKey=key;}if(oldestKey==null)break;this.delete(oldestKey);}}
  delete(key){const entry=this.map.get(String(key));if(!entry)return false;try{entry.texture.destroy?.();}catch{}this.bytes-=entry.byteLength;this.map.delete(String(key));return true;}
  clear(){for(const key of [...this.map.keys()])this.delete(key);}
  stats(){return{entries:this.map.size,bytes:this.bytes,maxBytes:this.maxBytes,maxEntries:this.maxEntries};}
}
