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
@group(0)@binding(0)var src:texture_2d<f32>;
@group(0)@binding(1)var smp:sampler;
struct O{@builtin(position)pos:vec4<f32>,@location(0)uv:vec2<f32>};
@vertex fn vs(@builtin(vertex_index)i:u32)->O{
  var c=array<vec2<f32>,6>(vec2(0.,0.),vec2(1.,0.),vec2(0.,1.),vec2(0.,1.),vec2(1.,0.),vec2(1.,1.));
  var o:O;o.uv=c[i];o.pos=vec4(c[i]*vec2(2.,-2.)+vec2(-1.,1.),0.,1.);return o;
}
fn linearToSrgb(x:f32)->f32{return select(12.92*x,1.055*pow(max(x,0.),1./2.4)-.055,x>.0031308);}
@fragment fn fs(i:O)->@location(0)vec4<f32>{
  let c=textureSample(src,smp,i.uv);
  return vec4(vec3(linearToSrgb(c.r),linearToSrgb(c.g),linearToSrgb(c.b)),c.a);
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
  add(encoder,weight){
    if(!this.scratch||!this.accumulation)throw new Error('GpuTemporalAccumulator.begin must be called first');
    const value=Number(weight);if(!(value>=0))throw new Error('Temporal sample weight must be non-negative');
    this.device.queue.writeBuffer(this.weightBuffer,0,new Float32Array([value,0,0,0]));
    const pass=encoder.beginRenderPass({colorAttachments:[{view:this.accumulation.createView(),loadOp:this.samples?'load':'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:0}}]});
    pass.setPipeline(this.accumulatePipeline);
    pass.setBindGroup(0,this.device.createBindGroup({layout:this.accumulatePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.scratch.createView()},{binding:1,resource:this.sampler},{binding:2,resource:{buffer:this.weightBuffer}}]}));
    pass.draw(6);pass.end();this.samples++;return this.samples;
  }
  finalize(encoder,targetView){
    if(!this.samples)throw new Error('Temporal accumulation has no samples');
    const pass=encoder.beginRenderPass({colorAttachments:[{view:targetView,loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});
    pass.setPipeline(this.finalPipeline);
    pass.setBindGroup(0,this.device.createBindGroup({layout:this.finalPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.accumulation.createView()},{binding:1,resource:this.sampler}]}));
    pass.draw(6);pass.end();return{samples:this.samples,workingFormat:this.workingFormat};
  }
  clear(){this.scratch?.destroy?.();this.accumulation?.destroy?.();this.weightBuffer?.destroy?.();this.scratch=null;this.accumulation=null;this.samples=0;this.width=0;this.height=0;}
}
