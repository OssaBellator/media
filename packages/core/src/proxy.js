const DERIVATIVE_TYPES = new Set(["thumbnail", "proxy-video", "proxy-audio", "waveform", "poster", "analysis"]);
function stable(value) { if (Array.isArray(value)) return value.map(stable); if (!value || typeof value !== "object") return value; return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])); }
function hash(value) { const input = JSON.stringify(stable(value)); let h = 0x811c9dc5; for (const char of input) { h ^= char.charCodeAt(0); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, "0"); }
function positive(value, fallback) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback; }

export function createDerivativeKey({ assetId, sourceHash = null, type, spec = {} } = {}) {
  if (!assetId) throw new Error("Derivative key requires assetId");
  if (!DERIVATIVE_TYPES.has(type)) throw new Error(`Unsupported derivative type: ${type}`);
  const signature = hash({ assetId, sourceHash, type, spec });
  return `derived:${assetId}:${type}:${signature}`;
}

export function proxyDimensions({ width, height }, { maxLongEdge = 1280, allowUpscale = false } = {}) {
  const w = positive(width, 1); const h = positive(height, 1); const edge = positive(maxLongEdge, 1280);
  const scale = allowUpscale ? edge / Math.max(w, h) : Math.min(1, edge / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scale };
}

export function chooseProxyTier(asset, { viewportWidth = 1920, devicePixelRatio = 1 } = {}) {
  const target = Math.max(320, positive(viewportWidth, 1920) * positive(devicePixelRatio, 1));
  const sourceEdge = Math.max(Number(asset?.width ?? 0), Number(asset?.height ?? 0));
  if (!sourceEdge) return "original";
  if (target <= 640 && sourceEdge > 640) return "540p";
  if (target <= 1280 && sourceEdge > 1280) return "720p";
  if (target <= 1920 && sourceEdge > 1920) return "1080p";
  return "original";
}

export function createProxySpec(asset, { tier = "720p", codec = "vp9" } = {}) {
  const edges = { "540p": 960, "720p": 1280, "1080p": 1920 };
  if (!edges[tier]) throw new Error(`Unsupported proxy tier: ${tier}`);
  const dimensions = proxyDimensions(asset, { maxLongEdge: edges[tier] });
  return { type: "proxy-video", tier, codec, width: dimensions.width, height: dimensions.height, audioCodec: "opus", bitrateMode: "quality", keyframeIntervalSeconds: 2 };
}

export function thumbnailTimes(duration, { count = 12, includeEndpoints = true } = {}) {
  const d = Math.max(0, Number(duration) || 0); const n = Math.max(0, Math.round(Number(count) || 0));
  if (!d || !n) return [];
  if (n === 1) return [d / 2];
  if (includeEndpoints) return Array.from({ length: n }, (_, index) => (d * index) / (n - 1));
  return Array.from({ length: n }, (_, index) => (d * (index + 1)) / (n + 1));
}

export function planDerivativesForSource(source, options = {}) {
  const tasks = [];
  const kind = source.mediaKind;
  if (["video", "image", "vector"].includes(kind)) {
    const times = kind === "video" ? thumbnailTimes(source.duration, { count: options.thumbnailCount ?? 12 }) : [0];
    tasks.push({ type: "thumbnail", spec: { width: options.thumbnailWidth ?? 320, format: "image/webp", quality: 0.8, times } });
  }
  if (kind === "video" && Math.max(Number(source.width ?? 0), Number(source.height ?? 0)) > (options.proxyLongEdge ?? 1280)) {
    tasks.push({ type: "proxy-video", spec: createProxySpec(source, { tier: options.proxyTier ?? "720p", codec: options.proxyCodec ?? "vp9" }) });
  }
  if (["audio", "music", "video"].includes(kind)) tasks.push({ type: "waveform", spec: { buckets: options.waveformBuckets ?? 1024, channels: "mixdown", normalization: "peak" } });
  return tasks.map((task) => ({ ...task, key: createDerivativeKey({ assetId: source.id, sourceHash: source.hash, type: task.type, spec: task.spec }) }));
}

export function planProjectDerivatives(sources, options = {}) {
  return sources.flatMap((source) => planDerivativesForSource(source, options).map((task) => ({ assetId: source.id, ...task })));
}
