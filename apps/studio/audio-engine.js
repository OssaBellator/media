import { audioScheduleForClip, dbToGain, nodesByKind } from "../../packages/core/src/index.js";

export class BrowserAudioMixer {
  constructor({ blobResolver } = {}) {
    if (typeof blobResolver !== "function") throw new Error("BrowserAudioMixer requires blobResolver");
    this.blobResolver = blobResolver;
    this.context = null;
    this.master = null;
    this.buffers = new Map();
    this.sources = new Set();
    this.generation = 0;
  }

  supported() { return Boolean(globalThis.AudioContext ?? globalThis.webkitAudioContext); }

  async ensureContext() {
    if (!this.supported()) return null;
    if (!this.context) {
      const AudioContextCtor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      this.context = new AudioContextCtor({ latencyHint: "interactive" });
      this.master = this.context.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === "suspended") await this.context.resume();
    return this.context;
  }

  async decodeAsset(asset) {
    if (this.buffers.has(asset.id)) return this.buffers.get(asset.id);
    const context = await this.ensureContext();
    if (!context) return null;
    const blob = await this.blobResolver(asset.id, asset);
    if (!blob) return null;
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    this.buffers.set(asset.id, buffer);
    return buffer;
  }

  async play(graph, timelineTime = 0) {
    const context = await this.ensureContext();
    if (!context) return { scheduled: 0, unsupported: true };
    this.stop();
    const generation = ++this.generation;
    const clips = nodesByKind(graph, "clip").filter((clip) => {
      const track = graph.nodes[clip.props.trackId];
      return track?.props.mediaKind === "audio" && track.props.muted !== true && clip.props.enabled !== false;
    });
    const decoded = await Promise.all(clips.map(async (clip) => ({ clip, asset: graph.nodes[clip.props.assetId], schedule: audioScheduleForClip(clip, timelineTime) })).filter((entry) => entry.schedule).map(async (entry) => ({ ...entry, buffer: await this.decodeAsset(entry.asset).catch(() => null) })));
    if (generation !== this.generation) return { scheduled: 0, cancelled: true };
    let scheduled = 0;
    for (const { clip, schedule, buffer } of decoded) {
      if (!buffer || schedule.sourceOffset >= buffer.duration) continue;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = schedule.playbackRate;
      const gain = context.createGain();
      const pan = context.createStereoPanner ? context.createStereoPanner() : null;
      if (pan) pan.pan.value = schedule.pan;
      const startAt = context.currentTime + schedule.delay;
      const endAt = startAt + schedule.outputDuration;
      const baseGain = dbToGain(schedule.gainDb);
      gain.gain.setValueAtTime(baseGain, startAt);
      if (schedule.fadeIn > 0) {
        const remainingFadeIn = Math.max(0, schedule.fadeIn - Math.max(0, Number(timelineTime) - schedule.clipStart));
        if (remainingFadeIn > 0) { gain.gain.setValueAtTime(0, startAt); gain.gain.linearRampToValueAtTime(baseGain, Math.min(endAt, startAt + remainingFadeIn)); }
      }
      if (schedule.fadeOut > 0) {
        const fadeStartTimeline = schedule.clipEnd - schedule.fadeOut;
        const fadeStartAt = startAt + Math.max(0, fadeStartTimeline - Math.max(Number(timelineTime), schedule.clipStart));
        if (fadeStartAt < endAt) { gain.gain.setValueAtTime(baseGain, fadeStartAt); gain.gain.linearRampToValueAtTime(0, endAt); }
      }
      source.connect(gain);
      if (pan) { gain.connect(pan); pan.connect(this.master); } else gain.connect(this.master);
      const availableSource = Math.max(0, buffer.duration - schedule.sourceOffset);
      const sourceDuration = Math.min(schedule.sourceDuration, availableSource);
      if (sourceDuration <= 0) continue;
      source.start(startAt, schedule.sourceOffset, sourceDuration);
      source.addEventListener("ended", () => this.sources.delete(source), { once: true });
      this.sources.add(source);
      scheduled += 1;
    }
    return { scheduled, unsupported: false };
  }

  stop() {
    this.generation += 1;
    for (const source of this.sources) { try { source.stop(); } catch {} }
    this.sources.clear();
  }

  clearCache() { this.buffers.clear(); }

  async close() {
    this.stop();
    this.buffers.clear();
    if (this.context) await this.context.close().catch(() => {});
    this.context = null;
    this.master = null;
  }
}
