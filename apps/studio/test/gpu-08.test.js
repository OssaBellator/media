import assert from 'node:assert/strict';
import test from 'node:test';
import { GpuFrameTextureCache } from '../gpu-frame-cache.js';
import { MEDIA_EFFECT_WGSL } from '../gpu-effects.js';

test('GPU frame cache copies external frames and evicts least-recently-used textures', () => {
  const destroyed=[];const copies=[];let id=0;
  const device={queue:{copyExternalImageToTexture(source,destination,size){copies.push({source,destination,size});}},createTexture(){const n=++id;return{n,createView(){return{};},destroy(){destroyed.push(n);}};}};
  const cache=new GpuFrameTextureCache(device,{maxBytes:4*4*4*2,maxEntries:2});
  const f={displayWidth:4,displayHeight:4};
  const t1=cache.textureForFrame('a',f);const t2=cache.textureForFrame('b',f);cache.get('a');cache.textureForFrame('c',f);
  assert.equal(copies.length,3);assert.equal(cache.has('a'),true);assert.equal(cache.has('b'),false);assert.equal(cache.has('c'),true);assert.deepEqual(destroyed,[t2.n]);assert.equal(cache.stats().entries,2);cache.clear();assert.equal(destroyed.length,3);assert.notEqual(t1,null);
});

test('GPU effect shader contains brightness contrast saturation hue blur and opacity stages', () => {
  for(const token of ['brightness','contrast','saturation','hueRotate','blur','opacity'])assert.ok(MEDIA_EFFECT_WGSL.includes(token));
  assert.ok(MEDIA_EFFECT_WGSL.includes('textureSample'));
});

import { GpuEffectPipeline } from '../gpu-effects.js';
test('GPU effect pipeline uploads packed uniforms and records a fullscreen render pass', () => {
  const calls=[];const pass={setPipeline(){calls.push('pipeline');},setBindGroup(){calls.push('bind');},draw(n){calls.push(`draw:${n}`);},end(){calls.push('end');}};
  const pipeline={getBindGroupLayout(){return{};}};
  const device={
    queue:{writeBuffer(_buffer,_offset,data){calls.push(['uniforms',...data]);}},
    createShaderModule({code}){assert.ok(code.includes('@fragment'));return{};},
    createRenderPipeline(){return pipeline;},createSampler(){return{};},createBuffer(){return{destroy(){calls.push('destroy');}};},
    createBindGroup(){return{};},
  };
  const effect=new GpuEffectPipeline(device,{format:'bgra8unorm'});const encoder={beginRenderPass(){return pass;}};const texture={createView(){return{};}};
  effect.render(encoder,texture,{}, {width:100,height:50,brightness:1.2,contrast:.9,saturation:1.1,hueDegrees:90,blur:2,opacity:.8});
  const uniforms=calls.find((x)=>Array.isArray(x)&&x[0]==='uniforms');assert.ok(Math.abs(uniforms[1]-1.2)<1e-6);assert.ok(Math.abs(uniforms[4]-Math.PI/2)<1e-5);assert.ok(calls.includes('draw:3'));effect.destroy();assert.ok(calls.includes('destroy'));
});
