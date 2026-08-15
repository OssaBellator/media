import { DecodeScheduler, WeightedLruCache, frameCacheKey } from "../../packages/core/src/cache.js";
import { normalizeMask } from "../../packages/core/src/compositing.js";
import { captureVideoFrame } from "./media-engine.js";
import { rasterizeVectorMaskCanvas } from './vector-mask-raster.js';
import { rasterizeIntrinsicCanvas } from './intrinsic-raster.js';

function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value) || 0)); }
function abortError(){if(typeof DOMException==='function')return new DOMException('Canvas composition render aborted','AbortError');const error=new Error('Canvas composition render aborted');error.name='AbortError';return error;}
function createCanvas(width=1,height=1){if(typeof OffscreenCanvas==='function')return new OffscreenCanvas(width,height);const canvas=globalThis.document?.createElement?.('canvas');if(!canvas)throw new Error('Canvas composition rendering requires a canvas implementation');canvas.width=width;canvas.height=height;return canvas;}

export function canvasFilterFromEffects(effects = []) {
  const filters = [];
  for (const effect of effects) {
    const params = effect.params ?? {};
    if (effect.type === "brightness") filters.push(`brightness(${Number(params.amount ?? 1)})`);
    if (effect.type === "contrast") filters.push(`contrast(${Number(params.amount ?? 1)})`);
    if (effect.type === "saturation") filters.push(`saturate(${Number(params.amount ?? 1)})`);
    if (effect.type === "blur") filters.push(`blur(${Math.max(0, Number(params.radius ?? 0))}px)`);
    if (effect.type === "hue") filters.push(`hue-rotate(${Number(params.degrees ?? 0)}deg)`);
  }
  return filters.join(" ") || "none";
}

export function sourceRectForTransform(width, height, transform = {}) {
  const cropLeft = clamp(transform.cropLeft, 0, 1);
  const cropRight = clamp(transform.cropRight, 0, 1);
  const cropTop = clamp(transform.cropTop, 0, 1);
  const cropBottom = clamp(transform.cropBottom, 0, 1);
  const x = width * cropLeft;
  const y = height * cropTop;
  const w = width * Math.max(0.0001, 1 - cropLeft - cropRight);
  const h = height * Math.max(0.0001, 1 - cropTop - cropBottom);
  return { x, y, width: w, height: h };
}

function drawableDimensions(drawable) {
  return {
    width: Number(drawable?.displayWidth || drawable?.codedWidth || drawable?.videoWidth || drawable?.naturalWidth || drawable?.width || 0),
    height: Number(drawable?.displayHeight || drawable?.codedHeight || drawable?.videoHeight || drawable?.naturalHeight || drawable?.height || 0),
  };
}

export class BrowserFrameProvider {
  constructor({ blobResolver, maxCacheBytes = 256 * 1024 * 1024, concurrency = 2 } = {}) {
    if (typeof blobResolver !== "function") throw new Error("BrowserFrameProvider requires blobResolver");
    this.blobResolver = blobResolver;
    this.cache = new WeightedLruCache({ maxWeight: maxCacheBytes });
    this.scheduler = new DecodeScheduler({ concurrency });
  }

  async get(asset, time = 0, { fps = 30, width = 0, height = 0, priority = 0, signal } = {}) {
    if (!asset?.id) throw new Error("Frame provider requires an asset");
    const key = frameCacheKey({ assetId: asset.id, time, fps, width, height, variant: asset.props.mediaKind });
    const cached = this.cache.get(key);
    if (cached) return cached;
    return this.scheduler.schedule(key, async ({ signal: taskSignal } = {}) => {
      if(taskSignal?.aborted)throw taskSignal.reason ?? abortError();
      const secondCached = this.cache.get(key);
      if (secondCached) return secondCached;
      const blob = await this.blobResolver(asset.id, asset);
      if(taskSignal?.aborted)throw taskSignal.reason ?? abortError();
      if (!blob) throw new Error(`Media source is offline: ${asset.name}`);
      let drawable;
      if (asset.props.mediaKind === "video") drawable = await captureVideoFrame(blob, time);
      else if (["image", "vector"].includes(asset.props.mediaKind) && "createImageBitmap" in globalThis) drawable = await createImageBitmap(blob);
      else throw new Error(`Asset ${asset.name} cannot be rendered as a visual source`);
      if(taskSignal?.aborted){try{drawable?.close?.();}catch{}throw taskSignal.reason ?? abortError();}
      const dimensions = drawableDimensions(drawable);
      const approximateBytes = Math.max(1, dimensions.width * dimensions.height * 4);
      this.cache.set(key, drawable, approximateBytes);
      return drawable;
    }, { priority, signal });
  }

  stats() { return { cache: this.cache.stats(), active: this.scheduler.active, queued: this.scheduler.queued, pending: this.scheduler.pending }; }
  clear() { this.cache.clear(); }
}

function canvasBlendMode(value) { return !value || value === "normal" ? "source-over" : value; }

function drawItem(context, canvas, drawable, item,{blendMode=item.blendMode}={}) {
  const dimensions = drawableDimensions(drawable);
  if (!dimensions.width || !dimensions.height) return;
  const transform = item.transform ?? {};
  const source = sourceRectForTransform(dimensions.width, dimensions.height, transform);
  const scaleX = Number(transform.scaleX ?? 1);
  const scaleY = Number(transform.scaleY ?? 1);
  const destinationWidth = source.width * scaleX;
  const destinationHeight = source.height * scaleY;
  const anchorX = clamp(transform.anchorX ?? 0.5, 0, 1);
  const anchorY = clamp(transform.anchorY ?? 0.5, 0, 1);
  const x = canvas.width / 2 + Number(transform.x ?? 0);
  const y = canvas.height / 2 + Number(transform.y ?? 0);

  context.save();
  context.globalAlpha = clamp(transform.opacity ?? 1, 0, 1);
  context.globalCompositeOperation = canvasBlendMode(blendMode);
  context.filter = canvasFilterFromEffects(item.effects);
  context.translate(x, y);
  context.rotate((Number(transform.rotation ?? 0) * Math.PI) / 180);
  context.drawImage(
    drawable,
    source.x, source.y, source.width, source.height,
    -destinationWidth * anchorX, -destinationHeight * anchorY, destinationWidth, destinationHeight,
  );
  context.restore();
}

function drawTextItem(context, canvas, item) {
  const transform = item.transform ?? {};
  const style = item.style ?? {};
  const x = canvas.width / 2 + Number(transform.x ?? 0);
  const y = canvas.height / 2 + Number(transform.y ?? 0);
  const fontSize = Number(style.fontSize ?? 96);
  const lines = String(item.text ?? "").split("\n");
  context.save();
  context.globalAlpha = clamp(transform.opacity ?? 1, 0, 1);
  context.globalCompositeOperation = canvasBlendMode(item.blendMode);
  context.filter = canvasFilterFromEffects(item.effects);
  context.translate(x, y);
  context.rotate((Number(transform.rotation ?? 0) * Math.PI) / 180);
  context.scale(Number(transform.scaleX ?? 1), Number(transform.scaleY ?? 1));
  context.fillStyle = style.color || "#ffffff";
  context.font = `${Number(style.fontWeight ?? 700)} ${fontSize}px ${style.fontFamily || "sans-serif"}`;
  context.textAlign = style.align || "center";
  context.textBaseline = "middle";
  const lineHeight = fontSize * Number(style.lineHeight ?? 1.1);
  const blockHeight = (lines.length - 1) * lineHeight;
  lines.forEach((line, index) => context.fillText(line, 0, index * lineHeight - blockHeight / 2));
  context.restore();
}

function roundedRectPath(context, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(Number(radius) || 0, Math.min(width, height) / 2));
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function drawShapeItem(context, canvas, item) {
  const transform = item.transform ?? {};
  const shape = item.shape ?? {};
  const width = Math.max(1, Number(shape.width ?? 500));
  const height = Math.max(1, Number(shape.height ?? 300));
  const x = canvas.width / 2 + Number(transform.x ?? 0);
  const y = canvas.height / 2 + Number(transform.y ?? 0);
  context.save();
  context.globalAlpha = clamp(transform.opacity ?? 1, 0, 1);
  context.globalCompositeOperation = canvasBlendMode(item.blendMode);
  context.filter = canvasFilterFromEffects(item.effects);
  context.translate(x, y);
  context.rotate((Number(transform.rotation ?? 0) * Math.PI) / 180);
  context.scale(Number(transform.scaleX ?? 1), Number(transform.scaleY ?? 1));
  context.fillStyle = shape.fill || "#ffffff";
  context.strokeStyle = shape.stroke || "transparent";
  context.lineWidth = Math.max(0, Number(shape.strokeWidth ?? 0));
  if (shape.type === "ellipse") {
    context.beginPath();
    context.ellipse(0, 0, width / 2, height / 2, 0, 0, Math.PI * 2);
  } else roundedRectPath(context, -width / 2, -height / 2, width, height, shape.cornerRadius ?? 0);
  context.fill();
  if (context.lineWidth > 0) context.stroke();
  context.restore();
}

export function alignedMaskGeometry(maskDrawable,item,sourceDimensions,canvas){
  const maskDimensions=drawableDimensions(maskDrawable),transform=item.transform??{},source=sourceRectForTransform(sourceDimensions.width,sourceDimensions.height,transform),maskSource=sourceRectForTransform(maskDimensions.width,maskDimensions.height,transform),scaleX=Number(transform.scaleX??1),scaleY=Number(transform.scaleY??1),anchorX=clamp(transform.anchorX??.5,0,1),anchorY=clamp(transform.anchorY??.5,0,1),destinationWidth=source.width*scaleX,destinationHeight=source.height*scaleY,x=canvas.width/2+Number(transform.x??0),y=canvas.height/2+Number(transform.y??0);return{maskSource,destinationWidth,destinationHeight,anchorX,anchorY,x,y,rotation:Number(transform.rotation??0)*Math.PI/180};
}
function drawAlignedMask(context,canvas,maskDrawable,item,sourceDimensions){const g=alignedMaskGeometry(maskDrawable,item,sourceDimensions,canvas);context.save();context.globalAlpha=1;context.globalCompositeOperation='source-over';context.filter='none';context.translate(g.x,g.y);context.rotate(g.rotation);context.drawImage(maskDrawable,g.maskSource.x,g.maskSource.y,g.maskSource.width,g.maskSource.height,-g.destinationWidth*g.anchorX,-g.destinationHeight*g.anchorY,g.destinationWidth,g.destinationHeight);context.restore();}
function blurAlpha(alpha,width,height,radius){const r=Math.max(0,Math.min(16,Math.round(Number(radius)||0)));if(!r)return alpha;const horizontal=new Float32Array(alpha.length),output=new Uint8ClampedArray(alpha.length);for(let y=0;y<height;y++){let sum=0;for(let x=-r;x<=r;x++)sum+=alpha[y*width+Math.max(0,Math.min(width-1,x))];for(let x=0;x<width;x++){horizontal[y*width+x]=sum/(r*2+1);sum-=alpha[y*width+Math.max(0,x-r)];sum+=alpha[y*width+Math.min(width-1,x+r+1)];}}for(let x=0;x<width;x++){let sum=0;for(let y=-r;y<=r;y++)sum+=horizontal[Math.max(0,Math.min(height-1,y))*width+x];for(let y=0;y<height;y++){output[y*width+x]=Math.round(sum/(r*2+1));sum-=horizontal[Math.max(0,y-r)*width+x];sum+=horizontal[Math.min(height-1,y+r+1)*width+x];}}return output;}
export function maskAlphaFromRgba(data,width,height,mask){const normalized=normalizeMask(mask),count=width*height,alpha=new Uint8ClampedArray(count);for(let i=0;i<count;i++){const offset=i*4,value=normalized.mode==='luma'?(data[offset]*.2126+data[offset+1]*.7152+data[offset+2]*.0722)*(data[offset+3]/255):data[offset+3];alpha[i]=Math.max(0,Math.min(255,Math.round(normalized.invert?255-value:value)));}const blurred=blurAlpha(alpha,width,height,normalized.feather),opacity=normalized.opacity;for(let i=0;i<count;i++)blurred[i]=Math.round(blurred[i]*opacity);return blurred;}
function normalizeMaskCanvas(context,canvas,mask){const image=context.getImageData(0,0,canvas.width,canvas.height),alpha=maskAlphaFromRgba(image.data,canvas.width,canvas.height,mask);for(let i=0;i<alpha.length;i++){const offset=i*4;image.data[offset]=255;image.data[offset+1]=255;image.data[offset+2]=255;image.data[offset+3]=alpha[i];}context.putImageData(image,0,0);}

async function renderMaskedSource(context,canvas,drawable,item,{assetResolver,frameProvider,priority,signal,fidelity,canvasFactory,sourceTime}){
  const mask=normalizeMask(item.mask),sourceDimensions=drawableDimensions(drawable),layer=canvasFactory(canvas.width,canvas.height);layer.width=canvas.width;layer.height=canvas.height;const layerContext=layer.getContext?.('2d');if(!layerContext)throw new Error('Masked Canvas2D rendering requires an offscreen context');drawItem(layerContext,layer,drawable,{...item,blendMode:'normal'});
  let maskDrawable,effectiveMask=mask;
  if(mask.type==='vector'){const raster=rasterizeVectorMaskCanvas(mask,{width:sourceDimensions.width,height:sourceDimensions.height,fidelity,canvasFactory});maskDrawable=raster.canvas;effectiveMask={...raster.effectiveMask,opacity:mask.opacity};}
  else{const maskAsset=assetResolver(mask.assetId);if(!maskAsset)throw new Error(`Missing mask asset ${mask.assetId}`);maskDrawable=await frameProvider.get(maskAsset,sourceTime,{priority:priority-1,signal});}
  const maskCanvas=canvasFactory(canvas.width,canvas.height);maskCanvas.width=canvas.width;maskCanvas.height=canvas.height;const maskContext=maskCanvas.getContext?.('2d');if(!maskContext)throw new Error('Masked Canvas2D rendering requires a mask context');drawAlignedMask(maskContext,maskCanvas,maskDrawable,item,sourceDimensions);normalizeMaskCanvas(maskContext,maskCanvas,effectiveMask);
  layerContext.save();layerContext.globalAlpha=1;layerContext.globalCompositeOperation='destination-in';layerContext.filter='none';layerContext.drawImage(maskCanvas,0,0);layerContext.restore();
  context.save();context.globalAlpha=1;context.globalCompositeOperation=canvasBlendMode(item.blendMode);context.filter='none';context.drawImage(layer,0,0);context.restore();
}

export async function renderPlanToCanvas2D(canvas, plan, { assetResolver, frameProvider, priority = 0, signal, fidelity=null, canvasFactory=createCanvas } = {}) {
  if (!canvas?.getContext) throw new Error("renderPlanToCanvas2D requires a canvas");
  if (typeof assetResolver !== "function") throw new Error("renderPlanToCanvas2D requires assetResolver");
  if (!frameProvider) throw new Error("renderPlanToCanvas2D requires frameProvider");
  canvas.width = Math.max(1, Math.round(Number(plan.width) || canvas.width || 1));
  canvas.height = Math.max(1, Math.round(Number(plan.height) || canvas.height || 1));
  const context = canvas.getContext("2d");
  context.save();
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  context.filter = "none";
  context.fillStyle = plan.background || "#000000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.restore();

  const errors = [];
  for (let index = 0; index < plan.visual.length; index += 1) {
    if(signal?.aborted)throw abortError();
    const item = plan.visual[index];
    if (item.kind === "text"&&!item.mask) { drawTextItem(context, canvas, item); continue; }
    if (item.kind === "shape"&&!item.mask) { drawShapeItem(context, canvas, item); continue; }
    try {
      const sourceTime = item.sourceTime ?? plan.time ?? 0;
      let drawable,renderItem=item;
      if(item.assetId){const asset=assetResolver(item.assetId);if(!asset)throw new Error(`Missing asset ${item.assetId}`);drawable=await frameProvider.get(asset, sourceTime, { fps: Number(plan.fps)||30, width: canvas.width, height: canvas.height, priority: priority - index, signal });}
      else if(['text','shape'].includes(item.kind)){const intrinsic=rasterizeIntrinsicCanvas(item,{canvasFactory});drawable=intrinsic.canvas;renderItem={...item,kind:'intrinsic-raster',transform:{...(item.transform??{}),anchorX:item.transform?.anchorX??intrinsic.anchor.x,anchorY:item.transform?.anchorY??intrinsic.anchor.y}};}
      else throw new Error(`Unsupported visual item ${item.kind??'unknown'}`);
      if(item.mask)await renderMaskedSource(context,canvas,drawable,renderItem,{assetResolver,frameProvider,priority:priority-index,signal,fidelity,canvasFactory,sourceTime});
      else drawItem(context, canvas, drawable, renderItem);
    } catch (error) { if(error?.name==='AbortError')throw error;errors.push({ item, error: error.message }); }
  }
  return { canvas, errors };
}

export async function canvasToBlob(canvas, type = "image/png", quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Unable to encode canvas")), type, quality));
}
