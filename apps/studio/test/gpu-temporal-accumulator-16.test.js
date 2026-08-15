import test from 'node:test';
import assert from 'node:assert/strict';
import { GpuTemporalAccumulator, GPU_TEMPORAL_ACCUMULATE_WGSL, GPU_TEMPORAL_FINAL_WGSL } from '../gpu-temporal-accumulator.js';

function fakeDevice(){
  const pipelines=[],textures=[],writes=[];
  const device={
    pipelines,textures,writes,
    createSampler(){return{};},
    createShaderModule({code}){return{code};},
    createRenderPipeline(desc){const pipeline={desc,getBindGroupLayout(){return{};}};pipelines.push(pipeline);return pipeline;},
    createBuffer(){return{destroy(){this.destroyed=true;}};},
    createTexture(desc){const texture={desc,destroyed:false,createView(){return{texture};},destroy(){this.destroyed=true;}};textures.push(texture);return texture;},
    createBindGroup(value){return value;},
    queue:{writeBuffer(_buffer,_offset,data){writes.push([...data]);}},
  };
  return device;
}
function encoder(){
  const passes=[];
  return{passes,beginRenderPass(desc){const pass={desc,setPipeline(value){this.pipeline=value;},setBindGroup(_index,value){this.bind=value;},draw(value){this.vertices=value;},end(){this.ended=true;}};passes.push(pass);return pass;}};
}
test('temporal accumulator uses additive rgba16float blending and linear-light conversion',()=>{
  const device=fakeDevice(),acc=new GpuTemporalAccumulator(device,{workingFormat:'rgba16float',targetFormat:'bgra8unorm'});
  assert.match(GPU_TEMPORAL_ACCUMULATE_WGSL,/srgbToLinear/);
  assert.match(GPU_TEMPORAL_FINAL_WGSL,/linearToSrgb/);
  const blend=device.pipelines[0].desc.fragment.targets[0].blend;
  assert.equal(blend.color.srcFactor,'one');assert.equal(blend.color.dstFactor,'one');
  assert.equal(blend.alpha.srcFactor,'one');assert.equal(blend.alpha.dstFactor,'one');
  acc.begin(4,2);
  const first=encoder(),second=encoder(),final=encoder();
  acc.add(first,.25);acc.add(second,.75);acc.finalize(final,{target:true});
  assert.equal(first.passes[0].desc.colorAttachments[0].loadOp,'clear');
  assert.equal(second.passes[0].desc.colorAttachments[0].loadOp,'load');
  assert.deepEqual(device.writes.map((value)=>value[0]),[.25,.75]);
  assert.equal(final.passes[0].desc.colorAttachments[0].loadOp,'clear');
  assert.equal(acc.samples,2);
});
test('begin resets sample count and resizes owned textures only when dimensions change',()=>{
  const device=fakeDevice(),acc=new GpuTemporalAccumulator(device);
  acc.begin(2,2);const first=[acc.scratch,acc.accumulation],e=encoder();acc.add(e,1);
  acc.begin(2,2);assert.equal(acc.samples,0);assert.equal(acc.scratch,first[0]);assert.equal(acc.accumulation,first[1]);
  acc.begin(3,2);assert.equal(first[0].destroyed,true);assert.equal(first[1].destroyed,true);
});
test('finalize rejects an empty accumulation',()=>{const acc=new GpuTemporalAccumulator(fakeDevice());acc.begin(1,1);assert.throws(()=>acc.finalize(encoder(),{}),/no samples/);});
