import { normalizeMask } from '../../packages/core/src/compositing.js';
import { vectorSupersampleForFidelity } from '../../packages/core/src/fidelity-render.js';
import { rasterizeVectorMatte } from '../../packages/core/src/vector-matte.js';

function createCanvas(width,height){if(typeof OffscreenCanvas==='function')return new OffscreenCanvas(width,height);const canvas=globalThis.document?.createElement?.('canvas');if(!canvas)throw new Error('Vector mask rasterization requires a canvas implementation');canvas.width=width;canvas.height=height;return canvas;}

export function vectorMaskRasterPlan(mask,{width,height,fidelity}={}){
  const normalized=normalizeMask(mask);
  if(normalized?.type!=='vector')throw new Error('Vector mask raster plan requires vector paths');
  return{
    width:Math.max(1,Math.round(Number(width)||1)),
    height:Math.max(1,Math.round(Number(height)||1)),
    paths:normalized.paths,
    fillRule:normalized.fillRule,
    feather:normalized.feather,
    invert:normalized.invert,
    supersample:vectorSupersampleForFidelity(fidelity),
    opacity:normalized.opacity,
  };
}

export function rasterizeVectorMaskCanvas(mask,{width,height,fidelity,canvasFactory=createCanvas}={}){
  const plan=vectorMaskRasterPlan(mask,{width,height,fidelity});
  const matte=rasterizeVectorMatte(plan),canvas=canvasFactory(plan.width,plan.height);
  canvas.width=plan.width;canvas.height=plan.height;
  const context=canvas.getContext?.('2d');
  if(!context)throw new Error('Vector mask rasterization requires Canvas2D');
  const image=context.createImageData?.(plan.width,plan.height)??context.getImageData?.(0,0,plan.width,plan.height);
  if(!image?.data)throw new Error('Vector mask rasterization requires ImageData access');
  for(let i=0;i<matte.alpha.length;i++){const offset=i*4;image.data[offset]=255;image.data[offset+1]=255;image.data[offset+2]=255;image.data[offset+3]=matte.alpha[i];}
  context.putImageData(image,0,0);
  return{canvas,matte,plan,effectiveMask:{...normalizeMask(mask),invert:false,feather:0}};
}
