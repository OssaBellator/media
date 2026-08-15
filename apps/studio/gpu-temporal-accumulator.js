export const GPU_TEMPORAL_ACCUMULATE_WGSL=`
struct P{weight:f32,_pad:vec3<f32>};
@group(0)@binding(0)var src:texture_2d<f32>;
@group(0)@binding(1)var smp:sampler;
@group(0)@binding(2)var<uniform>p:P;
struct O{@builtin(position)pos:vec4<f32>,@location(0)uv:vec2<f32>};
@vertex fn vs(@builtin(vertex_index)i:u32)->O{
  var c=array<vec2<f32>,6>(vec2(0.,0.),vec2(1.,0.),vec2(0.,1.),vec2(0.,1.),vec2(1.,0.),vec2(1.,1.));
  var o:O;o.uv=c[i];o.pos=vec4(c[i]*vec2(2.,-2.)+vec2(-1.,1.),0.,1.);return o;
}
fn srgbToLinear(x:f32)->f32{return select(x/12.92,pow((x+.055)/1.055,2.4),x>.04045);}
@fragment fn fs(i:O)->@location(0)vec4<f32>{
  let c=textureSample(src,smp,i.uv);
  return vec4(vec3(srgbToLinear(c.r),srgbToLinear(c.g),srgbToLinear(c.b))*p.weight,c.a*p.weight);
}`;
export const GPU_TEMPORAL_FINAL_WGSL=`
struct P{method:f32,sourcePeak:f32,targetPeak:f32,_pad:f32};
@group(0)@binding(0)var src:texture_2d<f32>;
@group(0)@binding(1)var smp:sampler;
@group(0)@binding(2)var<uniform>p:P;
struct O{@builtin(position)pos:vec4<f32>,@location(0)uv:vec2<f32>};
@vertex fn vs(@builtin(vertex_index)i:u32)->O{
  var c=array<vec2<f32>,6>(vec2(0.,0.),vec2(1.,0.),vec2(0.,1.),vec2(0.,1.),vec2(1.,0.),vec2(1.,1.));
  var o:O;o.uv=c[i];o.pos=vec4(c[i]*vec2(2.,-2.)+vec2(-1.,1.),0.,1.);return o;
}
fn aces(x:vec3<f32>)->vec3<f32>{return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),vec3(0.),vec3(1.));}
fn hable1(x:f32)->f32{let A=.15;let B=.50;let C=.10;let D=.20;let E=.02;let F=.30;return ((x*(A*x+C*B)+D*E)/(x*(A*x+B)+D*F))-E/F;}
fn tone(x:vec3<f32>,m:f32)->vec3<f32>{if(m==2.){return x/(vec3(1.)+x);}if(m==3.){return clamp(vec3(hable1(x.r),hable1(x.g),hable1(x.b))/max(hable1(11.2),1e-6),vec3(0.),vec3(1.));}if(m==4.){return clamp(x,vec3(0.),vec3(1.));}return aces(x);}
fn linearToSrgb(x:f32)->f32{return select(12.92*x,1.055*pow(max(x,0.),1./2.4)-.055,x>.0031308);}
@fragment fn fs(i:O)->@location(0)vec4<f32>{
  var c=textureSample(src,smp,i.uv);
  if(p.method>0.){c.rgb=tone(c.rgb*max(1.,p.sourcePeak/max(1.,p.targetPeak)),p.method);}
  c.rgb=vec3(linearToSrgb(c.r),linearToSrgb(c.g),linearToSrgb(c.b));return c;
}`;

function textureUsage(){return(globalThis.GPUTextureUsage?.TEXTURE_BINDING??4)|(globalThis.GPUTextureUsage?.RENDER_ATTACHMENT??16);}
function uniformUsage(){return(globalThis.GPUBufferUsage?.UNIFORM??64)|(globalThis.GPUBufferUsage?.COPY_DST??8);}
export class GpuTemporalAccumulator{
  constructor(device,{workingFormat='rgba16float',targetFormat='bgra8unorm'}={}){
    if(!device)throw new Error('GpuTemporalAccumulator requires device');
    this.device=device;this.workingFormat=workingFormat;this.targetFormat=targetFormat;
    this.sampler=device.createSampler({magFilter:'linear',minFilter:'linear'});
    const accumulateModule=device.createShaderModule({code:GPU_TEMPORAL_ACCUMULATE_WGSL}),finalModule=device.createShaderModule({code:GPU_TEMPORAL_FINAL_WGSL});
    this.accumulatePipeline=device.createRenderPipeline({layout:'auto',vertex:{module:accumulateModule,entryPoint:'vs'},fragment:{module:accumulateModule,entryPoint:'fs',targets:[{format:workingFormat,blend:{color:{srcFactor:'one',dstFactor:'one',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one',operation:'add'}}}]},primitive:{topology:'triangle-list'}});
    this.finalPipeline=device.createRenderPipeline({layout:'auto',vertex:{module:finalModule,entryPoint:'vs'},fragment:{module:finalModule,entryPoint:'fs',targets:[{format:targetFormat}]},primitive:{topology:'triangle-list'}});
    this.weightBuffer=device.createBuffer({size:16,usage:uniformUsage()});
    this.finalBuffer=device.createBuffer({size:16,usage:uniformUsage()});
    this.width=0;this.height=0;this.scratch=null;this.accumulation=null;this.samples=0;
  }
  #texture(){return this.device.createTexture({size:{width:this.width,height:this.height,depthOrArrayLayers:1},format:this.workingFormat,usage:textureUsage()});}
  begin(width,height){
    const w=Math.max(1,Math.round(Number(width)||1)),h=Math.max(1,Math.round(Number(height)||1));
    if(w!==this.width||h!==this.height||!this.scratch||!this.accumulation){
      this.scratch?.destroy?.();this.accumulation?.destroy?.();this.width=w;this.height=h;this.scratch=this.#texture();this.accumulation=this.#texture();
    }
    this.samples=0;return this;
  }
  scratchView(){if(!this.scratch)throw new Error('GpuTemporalAccumulator.begin must be called first');return this.scratch.createView();}
  add(encoder,sourceTexture,weight){
    if(!this.scratch||!this.accumulation)throw new Error('GpuTemporalAccumulator.begin must be called first');
    const value=Number(weight);if(!(value>=0))throw new Error('Temporal sample weight must be non-negative');
    this.device.queue.writeBuffer(this.weightBuffer,0,new Float32Array([value,0,0,0]));
    const pass=encoder.beginRenderPass({colorAttachments:[{view:this.accumulation.createView(),loadOp:this.samples?'load':'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]});
    pass.setPipeline(this.accumulatePipeline);
    pass.setBindGroup(0,this.device.createBindGroup({layout:this.accumulatePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:(sourceTexture??this.scratch).createView()},{binding:1,resource:this.sampler},{binding:2,resource:{buffer:this.weightBuffer}}]}));
    pass.draw(6);pass.end();this.samples++;return this.samples;
  }
  finalize(encoder,targetView,{toneMap=null,sourcePeakNits=100}={}){
    if(!this.samples)throw new Error('Temporal accumulation has no samples');
    const methods={aces:1,reinhard:2,hable:3,clip:4},resolvedPeak=Math.max(100,Number(sourcePeakNits)||100),params=toneMap?new Float32Array([methods[toneMap.method??'aces']??1,Number(toneMap.sourcePeakNits??resolvedPeak),Number(toneMap.targetPeakNits??100),0]):new Float32Array([0,100,100,0]);
    this.device.queue.writeBuffer(this.finalBuffer,0,params);
    const pass=encoder.beginRenderPass({colorAttachments:[{view:targetView,loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});
    pass.setPipeline(this.finalPipeline);
    pass.setBindGroup(0,this.device.createBindGroup({layout:this.finalPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.accumulation.createView()},{binding:1,resource:this.sampler},{binding:2,resource:{buffer:this.finalBuffer}}]}));
    pass.draw(6);pass.end();return{samples:this.samples,workingFormat:this.workingFormat,toneMap:toneMap??null,sourcePeakNits:resolvedPeak};
  }
  clear(){this.scratch?.destroy?.();this.accumulation?.destroy?.();this.weightBuffer?.destroy?.();this.finalBuffer?.destroy?.();this.scratch=null;this.accumulation=null;this.samples=0;this.width=0;this.height=0;}
}
