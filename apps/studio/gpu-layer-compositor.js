import { GpuFrameTextureCache } from './gpu-frame-cache.js';

export const GPU_LAYER_WGSL = `
struct Params {
  canvas: vec2<f32>, source: vec2<f32>, position: vec2<f32>, scale: vec2<f32>,
  anchor: vec2<f32>, cropLT: vec2<f32>, cropRB: vec2<f32>, rotation: f32,
  opacity: f32, brightness: f32, contrast: f32, saturation: f32,
  hue: f32, blur: f32, _pad0: vec2<f32>
};
@group(0) @binding(0) var sourceTex: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
@group(0) @binding(2) var<uniform> p: Params;
struct Out { @builtin(position) position:vec4<f32>, @location(0) uv:vec2<f32> };
@vertex fn vs(@builtin(vertex_index) index:u32)->Out {
  var corners=array<vec2<f32>,6>(vec2(0.,0.),vec2(1.,0.),vec2(0.,1.),vec2(0.,1.),vec2(1.,0.),vec2(1.,1.));
  let local=corners[index];
  let visible=vec2(1.-p.cropLT.x-p.cropRB.x,1.-p.cropLT.y-p.cropRB.y);
  let size=p.source*visible*p.scale;
  let relative=(local-p.anchor)*size;
  let co=cos(p.rotation); let s=sin(p.rotation);
  let rotated=vec2(relative.x*co-relative.y*s,relative.x*s+relative.y*co);
  let px=p.canvas*.5+p.position+rotated;
  let ndc=vec2(px.x/p.canvas.x*2.-1.,1.-px.y/p.canvas.y*2.);
  var o:Out;o.position=vec4(ndc,0.,1.);o.uv=mix(p.cropLT,vec2(1.)-p.cropRB,local);return o;
}
fn hueRotate(c:vec3<f32>,a:f32)->vec3<f32>{let s=sin(a);let co=cos(a);let m=mat3x3<f32>(vec3(.213+.787*co-.213*s,.715-.715*co-.715*s,.072-.072*co+.928*s),vec3(.213-.213*co+.143*s,.715+.285*co+.140*s,.072-.072*co-.283*s),vec3(.213-.213*co-.787*s,.715-.715*co+.715*s,.072+.928*co+.072*s));return m*c;}
fn fetch(uv:vec2<f32>)->vec4<f32>{if(p.blur<=.01){return textureSample(sourceTex,sourceSampler,uv);}let texel=1./p.source;let d=texel*min(p.blur,8.);var c=textureSample(sourceTex,sourceSampler,uv)*.2;c+=textureSample(sourceTex,sourceSampler,uv+vec2(d.x,0.))*.1;c+=textureSample(sourceTex,sourceSampler,uv-vec2(d.x,0.))*.1;c+=textureSample(sourceTex,sourceSampler,uv+vec2(0.,d.y))*.1;c+=textureSample(sourceTex,sourceSampler,uv-vec2(0.,d.y))*.1;c+=textureSample(sourceTex,sourceSampler,uv+d)*.1;c+=textureSample(sourceTex,sourceSampler,uv-d)*.1;c+=textureSample(sourceTex,sourceSampler,uv+vec2(d.x,-d.y))*.1;c+=textureSample(sourceTex,sourceSampler,uv+vec2(-d.x,d.y))*.1;return c;}
@fragment fn fs(input:Out)->@location(0) vec4<f32>{var c=fetch(input.uv);c.rgb*=p.brightness;c.rgb=(c.rgb-.5)*p.contrast+.5;let l=dot(c.rgb,vec3(.2126,.7152,.0722));c.rgb=mix(vec3(l),c.rgb,p.saturation);c.rgb=hueRotate(c.rgb,p.hue);c.a*=p.opacity;return c;}`;

function clamp(value,min,max){return Math.min(max,Math.max(min,Number(value)||0));}
export function gpuEffectParams(effects=[]){const result={brightness:1,contrast:1,saturation:1,hueDegrees:0,blur:0};for(const effect of effects){if(effect?.enabled===false)continue;const p=effect?.params??{};if(effect?.type==='brightness')result.brightness=Number(p.amount??1);if(effect?.type==='contrast')result.contrast=Number(p.amount??1);if(effect?.type==='saturation')result.saturation=Number(p.amount??1);if(effect?.type==='hue')result.hueDegrees=Number(p.degrees??0);if(effect?.type==='blur')result.blur=Math.max(0,Number(p.radius??0));}return result;}
export function gpuPlanSupport(plan){if(!plan?.visual?.length)return{supported:false,reason:'empty'};for(const item of plan.visual){if(!item.assetId)return{supported:false,reason:`intrinsic-${item.kind}`};if(item.blendMode&&item.blendMode!=='normal')return{supported:false,reason:`blend-${item.blendMode}`};for(const effect of item.effects??[])if(!['brightness','contrast','saturation','hue','blur'].includes(effect.type))return{supported:false,reason:`effect-${effect.type}`};}return{supported:true,reason:'supported'};}
export function layerUniforms(item,{canvasWidth,canvasHeight,sourceWidth,sourceHeight}={}){const t=item?.transform??{},e=gpuEffectParams(item?.effects);return new Float32Array([
  Number(canvasWidth),Number(canvasHeight),Number(sourceWidth),Number(sourceHeight),
  Number(t.x??0),Number(t.y??0),Number(t.scaleX??1),Number(t.scaleY??1),
  clamp(t.anchorX??.5,0,1),clamp(t.anchorY??.5,0,1),clamp(t.cropLeft??0,0,1),clamp(t.cropTop??0,0,1),
  clamp(t.cropRight??0,0,1),clamp(t.cropBottom??0,0,1),(Number(t.rotation??0)*Math.PI)/180,clamp(t.opacity??1,0,1),
  Number(e.brightness),Number(e.contrast),Number(e.saturation),(Number(e.hueDegrees)*Math.PI)/180,
  Number(e.blur),0,0,0,
]);}
function parseHexBackground(value){const text=String(value??'#000000').trim();const match=/^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(text);if(!match)return{r:0,g:0,b:0,a:1};const raw=match[1].length===3?match[1].split('').map((x)=>x+x).join(''):match[1];return{r:parseInt(raw.slice(0,2),16)/255,g:parseInt(raw.slice(2,4),16)/255,b:parseInt(raw.slice(4,6),16)/255,a:1};}
export class GpuLayerCompositor {
  constructor(device,{format='bgra8unorm',frameCache=null,maxCacheBytes=256*1024*1024}={}){if(!device)throw new Error('GpuLayerCompositor requires a GPUDevice');this.device=device;this.format=format;this.frameCache=frameCache??new GpuFrameTextureCache(device,{maxBytes:maxCacheBytes});const module=device.createShaderModule({code:GPU_LAYER_WGSL});this.pipeline=device.createRenderPipeline({layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list'}});this.sampler=device.createSampler({magFilter:'linear',minFilter:'linear'});this.uniform=device.createBuffer({size:96,usage:(globalThis.GPUBufferUsage?.UNIFORM??64)|(globalThis.GPUBufferUsage?.COPY_DST??8)});}
  async resolve(plan,{assetResolver,frameProvider,priority=100,signal}={}){if(typeof assetResolver!=='function'||!frameProvider)throw new Error('GPU composition requires assetResolver and frameProvider');const support=gpuPlanSupport(plan);if(!support.supported)throw new Error(`GPU composition unsupported: ${support.reason}`);const layers=[];for(let index=0;index<plan.visual.length;index++){if(signal?.aborted)throw new DOMException('GPU composition aborted','AbortError');const item=plan.visual[index],asset=assetResolver(item.assetId);if(!asset)throw new Error(`Missing asset ${item.assetId}`);const frame=await frameProvider.get(asset,item.sourceTime??plan.time??0,{priority:priority-index,signal});layers.push({item,frame,key:`${asset.id}:${Number(frame?.timestamp??item.sourceTime??0)}`});}return layers;}
  renderResolved(encoder,targetView,plan,layers,{load=false}={}){const background=parseHexBackground(plan.background);const pass=encoder.beginRenderPass({colorAttachments:[{view:targetView,loadOp:load?'load':'clear',storeOp:'store',clearValue:background}]});pass.setPipeline(this.pipeline);for(const layer of layers){const texture=this.frameCache.textureForFrame(layer.key,layer.frame);const desc=this.frameCache.describe(layer.key);const uniforms=layerUniforms(layer.item,{canvasWidth:plan.width,canvasHeight:plan.height,sourceWidth:desc.width,sourceHeight:desc.height});this.device.queue.writeBuffer(this.uniform,0,uniforms);const bind=this.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:texture.createView()},{binding:1,resource:this.sampler},{binding:2,resource:{buffer:this.uniform}}]});pass.setBindGroup(0,bind);pass.draw(6);}pass.end();return{layers:layers.length,backend:'webgpu-layers',cache:this.frameCache.stats()};}
  async renderToContext(context,plan,options={}){const layers=await this.resolve(plan,options);if(options.shouldCommit&&options.shouldCommit()===false)return{stale:true,layers};const encoder=this.device.createCommandEncoder();const result=this.renderResolved(encoder,context.getCurrentTexture().createView(),plan,layers);this.device.queue.submit([encoder.finish()]);return{...result,layersResolved:layers.length};}
  clear(){this.frameCache.clear();}
  destroy(){this.clear();try{this.uniform.destroy?.();}catch{}}
}
