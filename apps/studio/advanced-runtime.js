import { createAudioMixPlan } from '../../packages/core/src/audio.js';
import { MemoryByteSink, writableStreamByteSink } from '../../packages/core/src/byte-sink.js';
import { compactEncodedWindowFromSource } from '../../packages/core/src/encoded-window.js';
import { createRenderManifest } from '../../packages/core/src/deliver.js';
import { evaluateComposition } from '../../packages/core/src/evaluation.js';
import { demuxIsoBmffAutoSource } from '../../packages/core/src/isobmff-auto-range.js';
import { finalizeFragmentedMp4Streaming } from '../../packages/core/src/isobmff-stream-finalize.js';
import { analyzeLoudness, normalizeLoudness } from '../../packages/core/src/loudness.js';
import { sniffContainer } from '../../packages/core/src/media-kernel.js';
import { renderAutomatedMix } from '../../packages/core/src/offline-audio.js';
import { readRange } from '../../packages/core/src/range-source.js';
import { demuxWebmSource } from '../../packages/core/src/webm-range.js';
import { createCutPlaybackEngine } from './cut-playback-factory.js';
import { loadOrCreateDerivativeJob, runSegmentedDerivative } from './derivative-job-runner.js';
import { renderProgressiveTimelineExport, renderTimelineExport } from './deliver-runtime.js';
import { KernelCompositionFrameProvider } from './kernel-frame-provider.js';
import { createAssetRangeSource } from './media-source.js';
import { decodeCompressedAudioRanges } from './range-audio-decoder.js';
import { BrowserFrameProvider, renderPlanToCanvas2D } from './render-engine.js';
import { assembleRenderJob, loadOrCreateRenderJob, resumableRenderStorageKeys, runResumableRender } from './resumable-render-runner.js';
import { renderFragmentedMp4Chunk } from './render-segment.js';
import { createResumableRenderRangeSource } from './resumable-render-source.js';
import { generateStreamingVideoProxyArtifact } from './streaming-proxy.js';
import { deleteDerivedArtifact, estimateStorageQuota, loadAssetBlob, loadDerivedArtifact, loadStoredGraph, saveDerivedArtifact } from './storage.js';
import { decodeChunkDescriptors } from './webcodecs.js';

const activeControllers = new Map();
let graphProvider = () => loadStoredGraph();

export function setAdvancedRuntimeGraphProvider(provider) {
  if (typeof provider !== 'function') throw new Error('Advanced runtime graph provider must be a function');
  graphProvider = provider;
}

async function currentGraph() {
  const graph = await graphProvider();
  if (!graph?.nodes || !graph?.projectId) throw new Error('Advanced runtime graph is unavailable');
  return graph;
}

function toast(message, kind = 'info') {
  let node = document.querySelector('#advanced-runtime-toast');
  if (!node) {
    node = document.createElement('div');
    node.id = 'advanced-runtime-toast';
    Object.assign(node.style, {
      position: 'fixed', right: '18px', bottom: '18px', zIndex: 10000,
      maxWidth: '420px', padding: '10px 14px', borderRadius: '8px',
      background: '#17191f', color: '#fff', font: '12px system-ui', boxShadow: '0 10px 30px #0008',
    });
    document.body.appendChild(node);
  }
  node.textContent = message;
  node.dataset.kind = kind;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.remove(), 5000);
}

function safeName(value) { return String(value || 'media').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'media'; }
function download(bytes, name, type) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type });
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function blobResolver(assetId) { return loadAssetBlob(assetId).catch(() => null); }
const derivedStorage = {
  load: async (key) => (await loadDerivedArtifact(key))?.value ?? null,
  save: (key, value, metadata = {}) => saveDerivedArtifact(key, value, metadata),
  remove: (key) => deleteDerivedArtifact(key),
};
async function reportStoragePressure() {
  const estimate = await estimateStorageQuota().catch(() => null);
  if (estimate?.quota && estimate.ratio >= .8) toast(`Local media cache is ${Math.round(estimate.ratio * 100)}% of browser quota`, 'warning');
  return estimate;
}
async function decodeBlobPcm(blob) {
  const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Ctor) throw new Error('AudioContext is unavailable for offline decode');
  const context = new Ctor();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    return { sampleRate: decoded.sampleRate, length: decoded.length, channels: Array.from({ length: decoded.numberOfChannels }, (_, index) => new Float32Array(decoded.getChannelData(index))) };
  } finally { await context.close().catch(() => {}); }
}
async function demuxRangeSource(source, asset) {
  const head = await readRange(source, 0, Math.min(32, source.size));
  const container = sniffContainer({ mimeType: asset?.props?.mimeType, name: asset?.name, bytes: head });
  if (container === 'mp4' || container === 'mov') return demuxIsoBmffAutoSource(source, { container });
  if (container === 'webm') return demuxWebmSource(source);
  throw new Error(`Range source container ${container} is unsupported`);
}
function sourceRangesForAsset(plan, assetId) {
  return plan.sources.filter((item) => item.assetId === assetId).map((item) => {
    const start = Number(item.sourceInSample ?? 0) / Number(plan.sampleRate);
    const timelineFrames = Math.max(0, Number(item.endSample) - Number(item.startSample));
    const duration = timelineFrames / Number(plan.sampleRate) * Math.max(0, Number(item.playbackRate ?? 1));
    return { start, end: start + duration };
  });
}
async function decodeAssetPcmRange(graph, plan, assetId, { signal } = {}) {
  const asset = graph.nodes[assetId];
  if (!asset) throw new Error(`Audio source ${assetId} is unavailable`);
  const source = await createAssetRangeSource(asset, { blobResolver, maxCacheBytes: 96 * 1024 * 1024 });
  const demux = await demuxRangeSource(source, asset), track = demux.tracks.find((item) => item.type === 'audio');
  if (!track) throw new Error(`No compressed audio track found for ${asset.name}`);
  const chunks = demux.chunks.filter((chunk) => chunk.trackId === track.id), ranges = sourceRangesForAsset(plan, assetId);
  return decodeCompressedAudioRanges({ ranges, source, track, chunks, signal, decodeChunkDescriptors, rangeMergeGap: .08 });
}
export async function renderOfflineAudio(graph, output, { start, end, sampleRate = 48000, signal } = {}) {
  const plan = createAudioMixPlan(graph, { start, end, sampleRate, blockSize: 1024 });
  if (!plan.sources.length) return null;
  const sources = new Map();
  for (const assetId of new Set(plan.sources.map((item) => item.assetId))) {
    if (signal?.aborted) throw new DOMException('Audio render aborted', 'AbortError');
    try {
      const sparse = await decodeAssetPcmRange(graph, plan, assetId, { signal });
      if (sparse?.sampleRate > 0) sources.set(assetId, sparse); else throw new Error('Sparse decoder produced no PCM');
    } catch (rangeError) {
      const blob = await blobResolver(assetId); if (!blob) continue;
      try { sources.set(assetId, await decodeBlobPcm(blob)); } catch { throw rangeError; }
    }
  }
  const clipAutomation = {};
  for (const item of plan.sources) { const clip = graph.nodes[item.clipId]; if (clip?.props?.audioAutomation) clipAutomation[item.clipId] = clip.props.audioAutomation; }
  let pcm = renderAutomatedMix(plan, sources, { channels: 2, clipAutomation, masterAutomation: output.props?.audioAutomation ?? {} });
  const before = analyzeLoudness(pcm);
  if (Number.isFinite(Number(output.props?.loudnessTargetLufs))) {
    const normalized = normalizeLoudness(pcm, { targetLufs: Number(output.props.loudnessTargetLufs), maxTruePeakDbfs: Number(output.props.maxTruePeakDbfs ?? -1) });
    pcm = normalized.buffer; pcm.loudness = { before, after: normalized.after, gainDb: normalized.gainDb };
  } else pcm.loudness = { before };
  return pcm;
}
async function createFileSink(name, mimeType) {
  if (typeof globalThis.showSaveFilePicker !== 'function') throw new Error('Streaming file output requires the File System Access API');
  const extension = name.endsWith('.webm') ? '.webm' : '.mp4';
  const handle = await showSaveFilePicker({ suggestedName: name, types: [{ description: mimeType, accept: { [mimeType]: [extension] } }] });
  return writableStreamByteSink(await handle.createWritable());
}
function outputCodecOptions(output, container, hasAudio) {
  const width = Number(output.props.width), height = Number(output.props.height), mp4 = container === 'mp4';
  return {
    videoConfig: mp4 ? { codec: 'avc1.640028', bitrate: Math.max(1_000_000, width * height * 4), avc: { format: 'avc' } } : { codec: 'vp09.00.10.08', bitrate: Math.max(800_000, width * height * 3) },
    audioConfig: hasAudio ? (mp4 ? { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 } : { codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 160000 }) : null,
  };
}
function createRenderContext(graph) {
  const videoEngine = createCutPlaybackEngine({ blobResolver, sourceCacheBytes: 160 * 1024 * 1024 });
  const fallbackProvider = new BrowserFrameProvider({ blobResolver, maxCacheBytes: 128 * 1024 * 1024, concurrency: 2 });
  const frameProvider = new KernelCompositionFrameProvider({ videoEngine, fallbackProvider, fallbackVideo: false });
  return { videoEngine, fallbackProvider, frameProvider, close() { videoEngine.close(); fallbackProvider.clear?.(); } };
}
function renderFrameFactory(graph, output, context) {
  const width = Number(output.props.width), height = Number(output.props.height);
  return async (time) => {
    const plan = evaluateComposition(graph, { compositionId: output.props.compositionId, time }), source = document.createElement('canvas');
    const result = await renderPlanToCanvas2D(source, plan, { assetResolver: (id) => graph.nodes[id], frameProvider: context.frameProvider });
    if (result.errors.length) throw new Error(`Render frame has ${result.errors.length} unavailable visual source${result.errors.length === 1 ? '' : 's'}`);
    const target = document.createElement('canvas'); target.width = width; target.height = height; target.getContext('2d').drawImage(source, 0, 0, width, height); return target;
  };
}
async function renderOutput(outputId, container, { stream = false } = {}) {
  const graph = await currentGraph(), output = graph.nodes[outputId];
  if (!output) throw new Error('Output is unavailable');
  const manifest = createRenderManifest(graph, outputId), context = createRenderContext(graph), renderFrame = renderFrameFactory(graph, output, context);
  const audioPlan = createAudioMixPlan(graph, { start: Number(output.props.rangeStart ?? 0), end: Number(output.props.rangeEnd), sampleRate: 48000 }), hasAudio = audioPlan.sources.length > 0;
  const mp4 = container === 'mp4', filename = `${safeName(output.name)}.${mp4 ? 'mp4' : 'webm'}`, mimeType = mp4 ? 'video/mp4' : 'video/webm';
  const sink = stream ? await createFileSink(filename, mimeType) : null, codecs = outputCodecOptions(output, container, hasAudio);
  try {
    const renderOptions = { manifest, container, renderFrame, renderAudioPcm: hasAudio ? ({ start, end, sampleRate, signal }) => renderOfflineAudio(graph, output, { start, end, sampleRate, signal }) : null, ...codecs, sink, fragmented: stream && mp4, segmentDuration: 2, onProgress: ({ stage, ratio }) => toast(`${output.name}: ${stage} ${Math.round(ratio * 100)}%`) };
    const result = stream ? await renderProgressiveTimelineExport(renderOptions) : await renderTimelineExport(renderOptions);
    if (!stream) download(result.bytes, filename, mimeType);
    toast(stream ? `${output.name} streamed to ${mp4 ? 'fragmented MP4' : 'WebM'}` : `${output.name} rendered to ${mp4 ? 'MP4' : 'WebM'} (${Math.round(result.bytes.byteLength / 1024)} KB)`);
    return result;
  } finally { context.close(); }
}
async function completedRenderJob(graph, output) {
  const manifest = createRenderManifest(graph, output.id), fps = Number(manifest.settings.fps) || 30;
  const job = await loadOrCreateRenderJob({ manifest, storage: derivedStorage, chunkFrames: Math.max(1, Math.round(fps * 2)), maxAttempts: 3 });
  if (job.status !== 'complete') throw new Error(`Resumable render is ${job.status}; complete all segments before finalizing`);
  return { manifest, job };
}
async function renderResumableMp4(outputId, { toFile = false } = {}) {
  const graph = await currentGraph(), output = graph.nodes[outputId]; if (!output) throw new Error('Output is unavailable');
  const manifest = createRenderManifest(graph, outputId), fps = Number(manifest.settings.fps) || 30;
  const audioPlan = createAudioMixPlan(graph, { start: Number(output.props.rangeStart ?? 0), end: Number(output.props.rangeEnd), sampleRate: 48000 }), hasAudio = audioPlan.sources.length > 0;
  const context = createRenderContext(graph), renderFrame = renderFrameFactory(graph, output, context), codecs = outputCodecOptions(output, 'mp4', hasAudio), controller = new AbortController();
  activeControllers.set(outputId, controller);
  try {
    let job = await loadOrCreateRenderJob({ manifest, storage: derivedStorage, chunkFrames: Math.max(1, Math.round(fps * 2)), maxAttempts: 3 });
    toast(`${output.name}: resume ${job.chunks.filter((chunk) => chunk.status === 'complete').length}/${job.chunks.length} segments`);
    job = await runResumableRender({ job, manifest, storage: derivedStorage, signal: controller.signal, onProgress: ({ completedFrames, totalFrames }) => toast(`${output.name}: ${completedFrames}/${totalFrames} frames checkpointed`), renderSegment: ({ chunk, sequenceNumber, signal }) => renderFragmentedMp4Chunk({ manifest, chunk, sequenceNumber, signal, renderFrame, renderAudioPcm: hasAudio ? ({ start, end, sampleRate, signal }) => renderOfflineAudio(graph, output, { start, end, sampleRate, signal }) : null, ...codecs, onProgress: ({ stage, ratio }) => toast(`${output.name}: segment ${chunk.index + 1}/${job.chunks.length} ${stage} ${Math.round(ratio * 100)}%`) }) });
    const filename = `${safeName(output.name)}.resumable.mp4`, sink = toFile ? await createFileSink(filename, 'video/mp4') : new MemoryByteSink(), assembled = await assembleRenderJob({ job, storage: derivedStorage, sink });
    if (!toFile) download(assembled.result, filename, 'video/mp4');
    toast(`${output.name}: resumable MP4 complete · ${job.chunks.length} segments · ${Math.round(assembled.byteLength / 1024)} KB`); await reportStoragePressure(); return { job, assembled };
  } finally { activeControllers.delete(outputId); context.close(); }
}
async function finalizeResumableMp4(outputId) {
  const graph = await currentGraph(), output = graph.nodes[outputId]; if (!output) throw new Error('Output is unavailable');
  const { job } = await completedRenderJob(graph, output), source = await createResumableRenderRangeSource({ job, storage: derivedStorage, maxCachedParts: 2 });
  const filename = `${safeName(output.name)}.final.mp4`, toFile = typeof globalThis.showSaveFilePicker === 'function', sink = toFile ? await createFileSink(filename, 'video/mp4') : new MemoryByteSink();
  toast(`${output.name}: streaming classic MP4 sample tables…`);
  const result = await finalizeFragmentedMp4Streaming({ source, sink, onProgress: ({ samplesWritten, totalSamples }) => toast(`${output.name}: finalizing ${samplesWritten}/${totalSamples} samples`) });
  if (!toFile && result.sinkResult) download(result.sinkResult, filename, 'video/mp4'); toast(`${output.name}: finalized fast-start MP4 · ${result.sampleCount} samples · ${Math.round(result.byteLength / 1024)} KB`); return result;
}
async function clearResumableMp4Cache(outputId) {
  const graph = await currentGraph(), output = graph.nodes[outputId]; if (!output) throw new Error('Output is unavailable');
  const manifest = createRenderManifest(graph, outputId), fps = Number(manifest.settings.fps) || 30, job = await loadOrCreateRenderJob({ manifest, storage: derivedStorage, chunkFrames: Math.max(1, Math.round(fps * 2)), maxAttempts: 3 });
  const keys = resumableRenderStorageKeys(job), all = [keys.job, keys.init, ...keys.segments]; let removed = 0;
  for (const key of new Set(all)) if (await derivedStorage.remove(key).catch(() => false)) removed++;
  toast(`${output.name}: cleared ${removed} resumable render artifact${removed === 1 ? '' : 's'}`);
}
async function analyzeOutput(outputId) {
  const graph = await currentGraph(), output = graph.nodes[outputId]; if (!output) throw new Error('Output is unavailable');
  const pcm = await renderOfflineAudio(graph, output, { start: Number(output.props.rangeStart ?? 0), end: Number(output.props.rangeEnd), sampleRate: 48000 });
  if (!pcm) { toast('Output has no audible timeline sources'); return; }
  const result = pcm.loudness?.after ?? pcm.loudness?.before ?? analyzeLoudness(pcm); toast(`Integrated ${result.integratedLufs.toFixed(1)} LUFS · true peak ${result.truePeakDbfs.toFixed(1)} dBFS`);
}
async function buildProxy(assetId) {
  const graph = await currentGraph(), asset = graph.nodes[assetId];
  if (!asset || asset.kind !== 'asset' || asset.props.mediaKind !== 'video') throw new Error('Select a video asset first');
  const sourceReader = await createAssetRangeSource(asset, { blobResolver, maxCacheBytes: 128 * 1024 * 1024 }), plan = await demuxRangeSource(sourceReader, asset);
  const track = plan.tracks.find((item) => item.type === 'video'), audioTrack = plan.tracks.find((item) => item.type === 'audio'); if (!track) throw new Error('No video track found');
  const videoChunks = plan.chunks.filter((chunk) => chunk.trackId === track.id), audioChunks = audioTrack ? plan.chunks.filter((chunk) => chunk.trackId === audioTrack.id) : [];
  const source = { id: asset.id, hash: asset.props.hash, duration: plan.duration, width: track.width, height: track.height };
  const job = await loadOrCreateDerivativeJob({ source, type: 'proxy-video', spec: { width: Math.min(1280, track.width), height: Math.round(track.height * Math.min(1, 1280 / track.width) / 2) * 2, codec: 'vp9', decodeQueue: 6, encodeQueue: 6 }, keyframes: plan.seekPoints, segmentDuration: 4, storage: derivedStorage });
  toast(`Proxy: ${job.segments.filter((segment) => segment.status === 'complete').length}/${job.segments.length} segments complete`);
  const complete = await runSegmentedDerivative({ job, track, chunks: videoChunks, sourceReader, storage: derivedStorage, onProgress: ({ completedSegments, totalSegments }) => toast(`Proxy: ${completedSegments}/${totalSegments} segments`), generateSegment: async ({ segment, chunks, sourceBytes, signal }) => {
    const audioForSegment = audioChunks.filter((chunk) => { const time = Number(chunk.presentationTimestamp ?? chunk.timestamp ?? 0) / 1_000_000, end = time + Number(chunk.duration ?? 0) / 1_000_000; return time < segment.end && end > segment.start; });
    const compactAudio = audioForSegment.length ? await compactEncodedWindowFromSource(sourceReader, audioForSegment, { signal, mergeGap: 64 * 1024, maxMergedLength: 8 * 1024 * 1024 }) : null;
    return generateStreamingVideoProxyArtifact({ track, chunks, source: sourceBytes, spec: job.spec, audioTrack, audioChunks: compactAudio?.chunks ?? [], audioSource: compactAudio?.bytes ?? sourceBytes, signal });
  } });
  await derivedStorage.save(`proxy-manifest:${asset.id}`, { job: complete }); toast(`Proxy complete: ${complete.segments.length} streaming WebM segments`); await reportStoragePressure();
}

function selectedTarget() {
  const output = document.querySelector('.output-card.selected[data-select]');
  if (output) return { kind: 'output', id: output.dataset.select };
  const asset = document.querySelector('.asset-row.selected[data-select]');
  if (asset) return { kind: 'asset', id: asset.dataset.select };
  return null;
}
function createPanelButton(label, action) {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset.advancedAction = action; return button;
}
function ensurePanel() {
  let panel = document.querySelector('#advanced-runtime-panel');
  if (panel) return panel;
  panel = document.createElement('aside'); panel.id = 'advanced-runtime-panel'; panel.hidden = true;
  Object.assign(panel.style, { position: 'fixed', right: '18px', top: '68px', zIndex: 9000, display: 'none', gap: '6px', flexWrap: 'wrap', maxWidth: '340px', padding: '8px', borderRadius: '8px', background: '#111319e8', boxShadow: '0 8px 24px #0008' });
  document.body.appendChild(panel); return panel;
}
function refreshPanel() {
  const panel = ensurePanel(), target = selectedTarget(); panel.replaceChildren();
  if (!target) { panel.hidden = true; panel.style.display = 'none'; return; }
  panel.hidden = false; panel.style.display = 'flex'; panel.dataset.targetId = target.id; panel.dataset.targetKind = target.kind;
  if (target.kind === 'output') {
    for (const [label, action] of [['Render MP4', 'render-mp4'], ['Render WebM', 'render-webm'], ['Resume MP4', 'resume-mp4'], ['Finalize MP4', 'finalize-mp4'], ['Clear MP4 cache', 'clear-mp4'], ['Analyze loudness', 'loudness']]) panel.appendChild(createPanelButton(label, action));
    if (typeof globalThis.showSaveFilePicker === 'function') { panel.appendChild(createPanelButton('Resume MP4 to file', 'resume-mp4-file')); panel.appendChild(createPanelButton('Stream WebM', 'stream-webm')); }
  } else panel.appendChild(createPanelButton('Build/resume proxy', 'build-proxy'));
}
async function runPanelAction(action, targetId, button) {
  button.disabled = true;
  try {
    if (action === 'render-mp4') await renderOutput(targetId, 'mp4');
    else if (action === 'render-webm') await renderOutput(targetId, 'webm');
    else if (action === 'resume-mp4') await renderResumableMp4(targetId);
    else if (action === 'resume-mp4-file') await renderResumableMp4(targetId, { toFile: true });
    else if (action === 'finalize-mp4') await finalizeResumableMp4(targetId);
    else if (action === 'clear-mp4') await clearResumableMp4Cache(targetId);
    else if (action === 'loudness') await analyzeOutput(targetId);
    else if (action === 'stream-webm') await renderOutput(targetId, 'webm', { stream: true });
    else if (action === 'build-proxy') await buildProxy(targetId);
  } catch (error) { toast(error?.name === 'AbortError' ? 'Operation cancelled' : error.message, 'error'); }
  finally { button.disabled = false; }
}

function scheduleRefresh() { queueMicrotask(refreshPanel); }
document.addEventListener('click', (event) => {
  const actionButton = event.target.closest?.('[data-advanced-action]');
  if (actionButton) { event.preventDefault(); event.stopPropagation(); runPanelAction(actionButton.dataset.advancedAction, ensurePanel().dataset.targetId, actionButton); return; }
  scheduleRefresh();
});
document.addEventListener('change', scheduleRefresh);
document.addEventListener('submit', scheduleRefresh);
window.addEventListener('load', refreshPanel, { once: true });
queueMicrotask(refreshPanel);

export function cancelAdvancedRuntime(outputId) { const controller = activeControllers.get(String(outputId)); if (!controller) return false; controller.abort(); return true; }
export function closeAdvancedRuntime() { for (const controller of activeControllers.values()) controller.abort(); activeControllers.clear(); document.querySelector('#advanced-runtime-panel')?.remove(); }
