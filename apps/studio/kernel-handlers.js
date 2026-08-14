import {
  KernelRuntime, createDemuxPlan, createTrackDescriptor, decodeWavPcm,
  parseEbmlHeader, parseIsoMovieSummary, parseWav, sniffContainer,
} from '../../packages/core/src/index.js';
function bytesFromPayload(payload) { const input = payload?.bytes; if (input instanceof ArrayBuffer) return new Uint8Array(input); if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength); throw new Error('Kernel payload requires binary bytes'); }
export function inspectContainerPayload(payload) {
  const bytes = bytesFromPayload(payload);
  const container = payload.container && payload.container !== 'unknown' ? payload.container : sniffContainer({ mimeType: payload.mimeType, name: payload.name, bytes: bytes.subarray(0, 32) });
  if (container === 'wav') { const wav = parseWav(bytes); const track = createTrackDescriptor({ id: 'audio:0', type: 'audio', codec: wav.format.audioFormat === 3 ? `pcm-f${wav.format.bitsPerSample}` : `pcm-s${wav.format.bitsPerSample}`, sampleRate: wav.format.sampleRate, channels: wav.format.channels, duration: wav.duration }); return createDemuxPlan({ container: 'wav', duration: wav.duration, tracks: [track], metadata: { bitsPerSample: wav.format.bitsPerSample, frameCount: wav.frameCount } }); }
  if (container === 'mp4' || container === 'mov') { const summary = parseIsoMovieSummary(bytes); return { version: 1, container, duration: summary.movie?.durationSeconds ?? 0, tracks: [], seekPoints: [], metadata: { brands: summary.brands, topLevelBoxes: summary.topLevelBoxes, partial: true } }; }
  if (container === 'webm') { const header = parseEbmlHeader(bytes); return { version: 1, container: 'webm', duration: 0, tracks: [], seekPoints: [], metadata: { docType: header.docType, partial: true } }; }
  throw new Error(`No built-in inspector for container: ${container}`);
}
export function createDefaultKernelRuntime() {
  return new KernelRuntime()
    .register('demux', async (payload, { progress }) => { progress(.2, 'sniff'); const result = inspectContainerPayload(payload); progress(1, 'indexed'); return result; })
    .register('decode-audio', async (payload, { progress }) => { const bytes = bytesFromPayload(payload); const container = payload.container ?? sniffContainer({ mimeType: payload.mimeType, name: payload.name, bytes: bytes.subarray(0, 32) }); if (container !== 'wav') throw new Error(`Built-in audio decoder currently supports WAV only, received ${container}`); progress(.25, 'parse'); const decoded = decodeWavPcm(bytes); progress(1, 'decode'); return { sampleRate: decoded.pcm.sampleRate, length: decoded.pcm.length, channels: decoded.pcm.channels.map((channel) => channel.buffer) }; });
}
