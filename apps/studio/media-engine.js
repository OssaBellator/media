const DEFAULT_WAVEFORM_BINS = 96;

function bytesToHex(buffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function fingerprintBlob(blob, { sampleBytes = 1024 * 1024 } = {}) {
  if (!globalThis.crypto?.subtle) return null;
  const head = new Uint8Array(await blob.slice(0, sampleBytes).arrayBuffer());
  const tailStart = Math.max(0, blob.size - sampleBytes);
  const tail = new Uint8Array(await blob.slice(tailStart).arrayBuffer());
  const descriptor = new TextEncoder().encode(`${blob.size}:${blob.type}:`);
  const payload = new Uint8Array(descriptor.length + head.length + tail.length);
  payload.set(descriptor, 0);
  payload.set(head, descriptor.length);
  payload.set(tail, descriptor.length + head.length);
  return bytesToHex(await crypto.subtle.digest("SHA-256", payload));
}

export function downsampleChannels(channels, bins = DEFAULT_WAVEFORM_BINS) {
  if (!Array.isArray(channels) || !channels.length || !Number.isInteger(bins) || bins <= 0) return [];
  const length = Math.max(...channels.map((channel) => channel.length ?? 0));
  if (!length) return [];
  return Array.from({ length: bins }, (_, bin) => {
    const start = Math.floor((bin / bins) * length);
    const end = Math.max(start + 1, Math.floor(((bin + 1) / bins) * length));
    let peak = 0;
    for (const channel of channels) {
      for (let index = start; index < Math.min(end, channel.length); index += 1) peak = Math.max(peak, Math.abs(Number(channel[index]) || 0));
    }
    return Math.round(Math.min(1, peak) * 1000) / 1000;
  });
}

export async function decodeWaveform(blob, { bins = DEFAULT_WAVEFORM_BINS } = {}) {
  const AudioContextCtor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!AudioContextCtor) return [];
  const context = new AudioContextCtor();
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
    return downsampleChannels(channels, bins);
  } finally {
    await context.close().catch(() => {});
  }
}

async function elementMetadata(file) {
  if (!file.type.startsWith("video/") && !file.type.startsWith("audio/")) return {};
  const element = document.createElement(file.type.startsWith("video/") ? "video" : "audio");
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve) => {
      const done = () => resolve({
        duration: Number.isFinite(element.duration) ? element.duration : undefined,
        width: element.videoWidth || undefined,
        height: element.videoHeight || undefined,
      });
      element.addEventListener("loadedmetadata", done, { once: true });
      element.addEventListener("error", () => resolve({}), { once: true });
      element.preload = "metadata";
      element.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
}

export async function probeMedia(file, { waveformBins = DEFAULT_WAVEFORM_BINS } = {}) {
  const metadata = {};
  if (file.type.startsWith("image/") && "createImageBitmap" in globalThis) {
    try {
      const bitmap = await createImageBitmap(file);
      metadata.width = bitmap.width;
      metadata.height = bitmap.height;
      bitmap.close();
    } catch {}
  } else Object.assign(metadata, await elementMetadata(file));

  if (file.type.startsWith("audio/") && file.size <= 128 * 1024 * 1024) {
    try { metadata.waveform = await decodeWaveform(file, { bins: waveformBins }); } catch { metadata.waveform = []; }
  }
  metadata.hash = await fingerprintBlob(file).catch(() => null);
  return metadata;
}

export function mediaCapabilities() {
  return {
    indexedDb: "indexedDB" in globalThis,
    webCodecs: "VideoDecoder" in globalThis && "AudioDecoder" in globalThis,
    webGpu: Boolean(globalThis.navigator?.gpu),
    audioContext: Boolean(globalThis.AudioContext ?? globalThis.webkitAudioContext),
    imageBitmap: "createImageBitmap" in globalThis,
    fileSystemAccess: "showDirectoryPicker" in globalThis,
  };
}

export async function captureVideoFrame(blob, timeSeconds = 0) {
  if (typeof document === "undefined") throw new Error("Video frame capture requires a browser document");
  const video = document.createElement("video");
  const url = URL.createObjectURL(blob);
  try {
    video.muted = true;
    video.preload = "auto";
    await new Promise((resolve, reject) => {
      video.addEventListener("loadedmetadata", resolve, { once: true });
      video.addEventListener("error", () => reject(new Error("Unable to decode video metadata")), { once: true });
      video.src = url;
    });
    video.currentTime = Math.min(Math.max(0, Number(timeSeconds) || 0), Math.max(0, video.duration - 0.001));
    await new Promise((resolve, reject) => {
      video.addEventListener("seeked", resolve, { once: true });
      video.addEventListener("error", () => reject(new Error("Unable to seek video frame")), { once: true });
    });
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    return canvas;
  } finally { URL.revokeObjectURL(url); }
}
