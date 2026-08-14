import { DecodeScheduler, WeightedLruCache, frameCacheKey } from "../../packages/core/src/index.js";
import { captureVideoFrame } from "./media-engine.js";

function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value) || 0)); }

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
    width: Number(drawable?.videoWidth || drawable?.naturalWidth || drawable?.width || 0),
    height: Number(drawable?.videoHeight || drawable?.naturalHeight || drawable?.height || 0),
  };
}

export class BrowserFrameProvider {
  constructor({ blobResolver, maxCacheBytes = 256 * 1024 * 1024, concurrency = 2 } = {}) {
    if (typeof blobResolver !== "function") throw new Error("BrowserFrameProvider requires blobResolver");
    this.blobResolver = blobResolver;
    this.cache = new WeightedLruCache({ maxWeight: maxCacheBytes });
    this.scheduler = new DecodeScheduler({ concurrency });
  }

  async get(asset, time = 0, { fps = 30, width = 0, height = 0, priority = 0 } = {}) {
    if (!asset?.id) throw new Error("Frame provider requires an asset");
    const key = frameCacheKey({ assetId: asset.id, time, fps, width, height, variant: asset.props.mediaKind });
    const cached = this.cache.get(key);
    if (cached) return cached;
    return this.scheduler.schedule(key, async () => {
      const secondCached = this.cache.get(key);
      if (secondCached) return secondCached;
      const blob = await this.blobResolver(asset.id, asset);
      if (!blob) throw new Error(`Media source is offline: ${asset.name}`);
      let drawable;
      if (asset.props.mediaKind === "video") drawable = await captureVideoFrame(blob, time);
      else if (["image", "vector"].includes(asset.props.mediaKind) && "createImageBitmap" in globalThis) drawable = await createImageBitmap(blob);
      else throw new Error(`Asset ${asset.name} cannot be rendered as a visual source`);
      const dimensions = drawableDimensions(drawable);
      const approximateBytes = Math.max(1, dimensions.width * dimensions.height * 4);
      this.cache.set(key, drawable, approximateBytes);
      return drawable;
    }, { priority });
  }

  stats() { return { cache: this.cache.stats(), active: this.scheduler.active, queued: this.scheduler.queued, pending: this.scheduler.pending }; }
  clear() { this.cache.clear(); }
}

function canvasBlendMode(value) { return !value || value === "normal" ? "source-over" : value; }

function drawItem(context, canvas, drawable, item) {
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
  context.globalCompositeOperation = canvasBlendMode(item.blendMode);
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

export async function renderPlanToCanvas2D(canvas, plan, { assetResolver, frameProvider, priority = 0 } = {}) {
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
    const item = plan.visual[index];
    if (item.kind === "text") { drawTextItem(context, canvas, item); continue; }
    if (item.kind === "shape") { drawShapeItem(context, canvas, item); continue; }
    const asset = assetResolver(item.assetId);
    if (!asset) { errors.push({ item, error: `Missing asset ${item.assetId}` }); continue; }
    try {
      const sourceTime = item.sourceTime ?? plan.time ?? 0;
      const drawable = await frameProvider.get(asset, sourceTime, { fps: 30, width: canvas.width, height: canvas.height, priority: priority - index });
      drawItem(context, canvas, drawable, item);
    } catch (error) { errors.push({ item, error: error.message }); }
  }
  return { canvas, errors };
}

export async function canvasToBlob(canvas, type = "image/png", quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Unable to encode canvas")), type, quality));
}
