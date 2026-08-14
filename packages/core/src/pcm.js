function finite(value, label) { const parsed = Number(value); if (!Number.isFinite(parsed)) throw new Error(`${label} must be finite`); return parsed; }
export function dbToLinear(db = 0) { const value = finite(db, "dB"); return value <= -96 ? 0 : 10 ** (value / 20); }
export function createPcmBuffer({ channels = 2, sampleRate = 48000, length = 0 } = {}) {
  const count = Math.max(1, Math.round(finite(channels, "channels")));
  const rate = Math.max(1, Math.round(finite(sampleRate, "sampleRate")));
  const frames = Math.max(0, Math.round(finite(length, "length")));
  return { sampleRate: rate, length: frames, channels: Array.from({ length: count }, () => new Float32Array(frames)) };
}
export function clonePcmBuffer(buffer) { return { sampleRate: buffer.sampleRate, length: buffer.length, channels: buffer.channels.map((channel) => new Float32Array(channel)) }; }
export function pcmDuration(buffer) { return buffer.length / buffer.sampleRate; }

export function sampleLinear(channel, position) {
  if (!channel.length) return 0;
  if (position <= 0) return channel[0];
  if (position >= channel.length - 1) return channel[channel.length - 1];
  const left = Math.floor(position); const mix = position - left;
  return channel[left] * (1 - mix) + channel[left + 1] * mix;
}

export function resamplePcm(buffer, targetSampleRate) {
  const targetRate = Math.max(1, Math.round(finite(targetSampleRate, "targetSampleRate")));
  if (targetRate === buffer.sampleRate) return clonePcmBuffer(buffer);
  const ratio = buffer.sampleRate / targetRate;
  const length = Math.max(0, Math.round(buffer.length / ratio));
  const output = createPcmBuffer({ channels: buffer.channels.length, sampleRate: targetRate, length });
  for (let channelIndex = 0; channelIndex < output.channels.length; channelIndex += 1) {
    const source = buffer.channels[Math.min(channelIndex, buffer.channels.length - 1)];
    for (let frame = 0; frame < length; frame += 1) output.channels[channelIndex][frame] = sampleLinear(source, frame * ratio);
  }
  return output;
}

function panGains(pan) { const value = Math.max(-1, Math.min(1, Number(pan) || 0)); const angle = (value + 1) * Math.PI / 4; return [Math.cos(angle), Math.sin(angle)]; }
function envelope(frame, total, fadeInFrames, fadeOutFrames) {
  let value = 1;
  if (fadeInFrames > 0) value = Math.min(value, Math.max(0, Math.min(1, frame / fadeInFrames)));
  if (fadeOutFrames > 0) value = Math.min(value, Math.max(0, Math.min(1, (total - frame) / fadeOutFrames)));
  return value;
}

export function mixPcmInto(destination, source, { destinationStart = 0, sourceStart = 0, sourceFrames, playbackRate = 1, gainDb = 0, pan = 0, fadeIn = 0, fadeOut = 0 } = {}) {
  if (destination.sampleRate !== source.sampleRate) throw new Error("PCM sample rates must match before mixing");
  const destStart = Math.max(0, Math.round(finite(destinationStart, "destinationStart")));
  const srcStart = Math.max(0, finite(sourceStart, "sourceStart"));
  const rate = finite(playbackRate, "playbackRate"); if (rate <= 0) throw new Error("playbackRate must be positive");
  const available = Math.max(0, (source.length - srcStart) / rate);
  const frames = Math.max(0, Math.min(destination.length - destStart, sourceFrames == null ? Math.floor(available) : Math.round(finite(sourceFrames, "sourceFrames"))));
  const gain = dbToLinear(gainDb); const [leftPan, rightPan] = panGains(pan);
  const fadeInFrames = Math.max(0, Math.round(finite(fadeIn, "fadeIn") * destination.sampleRate));
  const fadeOutFrames = Math.max(0, Math.round(finite(fadeOut, "fadeOut") * destination.sampleRate));
  for (let frame = 0; frame < frames; frame += 1) {
    const sourcePosition = srcStart + frame * rate;
    const env = envelope(frame, frames, fadeInFrames, fadeOutFrames) * gain;
    if (destination.channels.length === 1) {
      let mixed = 0; for (const channel of source.channels) mixed += sampleLinear(channel, sourcePosition); mixed /= Math.max(1, source.channels.length);
      destination.channels[0][destStart + frame] += mixed * env;
    } else {
      const left = sampleLinear(source.channels[0], sourcePosition);
      const right = sampleLinear(source.channels[Math.min(1, source.channels.length - 1)], sourcePosition);
      destination.channels[0][destStart + frame] += left * env * leftPan;
      destination.channels[1][destStart + frame] += right * env * rightPan;
      for (let channelIndex = 2; channelIndex < destination.channels.length; channelIndex += 1) destination.channels[channelIndex][destStart + frame] += sampleLinear(source.channels[Math.min(channelIndex, source.channels.length - 1)], sourcePosition) * env;
    }
  }
  return destination;
}

export function peakPcm(buffer) { let peak = 0; for (const channel of buffer.channels) for (const sample of channel) peak = Math.max(peak, Math.abs(sample)); return peak; }
export function normalizePcm(buffer, { targetPeak = 0.98 } = {}) {
  const peak = peakPcm(buffer); if (!peak) return buffer;
  const scale = Math.max(0, finite(targetPeak, "targetPeak")) / peak;
  for (const channel of buffer.channels) for (let index = 0; index < channel.length; index += 1) channel[index] *= scale;
  return buffer;
}

export function renderPcmMix(plan, sources, { channels = 2, normalize = false } = {}) {
  const output = createPcmBuffer({ channels, sampleRate: plan.sampleRate, length: plan.sampleCount });
  for (const item of plan.sources ?? []) {
    let source = sources instanceof Map ? sources.get(item.assetId) : sources[item.assetId];
    if (!source) continue;
    if (source.sampleRate !== output.sampleRate) source = resamplePcm(source, output.sampleRate);
    const destinationStart = Math.max(0, item.startSample - plan.startSample);
    const sourceStart = Math.max(0, item.sourceInSample ?? 0);
    const sourceFrames = Math.max(0, item.endSample - item.startSample);
    mixPcmInto(output, source, { destinationStart, sourceStart, sourceFrames, playbackRate: item.playbackRate ?? 1, gainDb: item.gainDb ?? 0, pan: item.pan ?? 0, fadeIn: item.fadeIn ?? 0, fadeOut: item.fadeOut ?? 0 });
  }
  return normalize ? normalizePcm(output) : output;
}
