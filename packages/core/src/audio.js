import { nodesByKind } from "./graph.js";
import { activeClipsAtTime, sourceTimeForClip } from "./evaluation.js";
import { clipEnd } from "./timeline.js";

const MIN_DB = -96;

function finite(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be finite`);
  return parsed;
}

export function dbToGain(db = 0) {
  const value = finite(db, "dB");
  return value <= MIN_DB ? 0 : 10 ** (value / 20);
}

export function gainToDb(gain = 1) {
  const value = finite(gain, "gain");
  if (value <= 0) return MIN_DB;
  return Math.max(MIN_DB, 20 * Math.log10(value));
}

export function constantPowerPan(pan = 0) {
  const value = Math.max(-1, Math.min(1, finite(pan, "pan")));
  const angle = (value + 1) * Math.PI / 4;
  return { left: Math.cos(angle), right: Math.sin(angle) };
}

export function audioEnvelopeAtTime(clip, timelineTime) {
  const start = Number(clip.props.start ?? 0);
  const end = clipEnd(clip);
  const time = Number(timelineTime);
  if (time < start || time >= end) return 0;
  const fadeIn = Math.max(0, Number(clip.props.fadeIn ?? 0));
  const fadeOut = Math.max(0, Number(clip.props.fadeOut ?? 0));
  let envelope = 1;
  if (fadeIn > 0) envelope = Math.min(envelope, Math.max(0, Math.min(1, (time - start) / fadeIn)));
  if (fadeOut > 0) envelope = Math.min(envelope, Math.max(0, Math.min(1, (end - time) / fadeOut)));
  return envelope;
}

export function setClipAudioOperations(graph, clipId, patch = {}) {
  const clip = graph.nodes[clipId];
  if (!clip || clip.kind !== "clip") throw new Error(`Unknown clip: ${clipId}`);
  const track = graph.nodes[clip.props.trackId];
  if (track?.props.mediaKind !== "audio") throw new Error(`Clip ${clipId} is not on an audio track`);
  if (track.props.locked) throw new Error(`Track ${track.name} is locked`);
  const props = {};
  if (patch.gainDb !== undefined) props.gainDb = Math.max(MIN_DB, Math.min(24, finite(patch.gainDb, "gainDb")));
  if (patch.pan !== undefined) props.pan = Math.max(-1, Math.min(1, finite(patch.pan, "pan")));
  if (patch.fadeIn !== undefined) props.fadeIn = Math.max(0, Math.min(Number(clip.props.duration), finite(patch.fadeIn, "fadeIn")));
  if (patch.fadeOut !== undefined) props.fadeOut = Math.max(0, Math.min(Number(clip.props.duration), finite(patch.fadeOut, "fadeOut")));
  return [{ type: "node.update", nodeId: clipId, patch: { props } }];
}

export function evaluateAudioMix(graph, time) {
  return activeClipsAtTime(graph, time, { mediaKind: "audio" }).map((clip) => {
    const envelope = audioEnvelopeAtTime(clip, time);
    const gainDb = Number(clip.props.gainDb ?? 0);
    const gain = dbToGain(gainDb) * envelope;
    const pan = Number(clip.props.pan ?? 0);
    const channels = constantPowerPan(pan);
    return {
      clipId: clip.id,
      assetId: clip.props.assetId,
      sourceTime: sourceTimeForClip(clip, time),
      gainDb,
      envelope,
      gain,
      pan,
      leftGain: gain * channels.left,
      rightGain: gain * channels.right,
    };
  });
}

export function sampleForTime(time, sampleRate = 48000) {
  const rate = Math.max(1, Math.round(finite(sampleRate, "sampleRate")));
  return Math.max(0, Math.round(finite(time, "time") * rate));
}

export function timeForSample(sample, sampleRate = 48000) {
  const rate = Math.max(1, Math.round(finite(sampleRate, "sampleRate")));
  return Math.max(0, Math.round(finite(sample, "sample")) / rate);
}

export function createAudioMixPlan(graph, { start = 0, end, sampleRate = 48000, blockSize = 128 } = {}) {
  const rate = Math.max(1, Math.round(finite(sampleRate, "sampleRate")));
  const block = Math.max(1, Math.round(finite(blockSize, "blockSize")));
  const rangeStart = Math.max(0, finite(start, "start"));
  const maximum = nodesByKind(graph, "clip")
    .filter((clip) => graph.nodes[clip.props.trackId]?.props.mediaKind === "audio")
    .reduce((max, clip) => Math.max(max, clipEnd(clip)), rangeStart);
  const rangeEnd = Math.max(rangeStart, end === undefined ? maximum : finite(end, "end"));
  const startSample = sampleForTime(rangeStart, rate);
  const endSample = sampleForTime(rangeEnd, rate);
  return {
    sampleRate: rate,
    blockSize: block,
    start: rangeStart,
    end: rangeEnd,
    startSample,
    endSample,
    sampleCount: Math.max(0, endSample - startSample),
    blockCount: Math.ceil(Math.max(0, endSample - startSample) / block),
    sources: nodesByKind(graph, "clip")
      .filter((clip) => graph.nodes[clip.props.trackId]?.props.mediaKind === "audio")
      .filter((clip) => clipEnd(clip) > rangeStart && Number(clip.props.start ?? 0) < rangeEnd)
      .map((clip) => ({
        clipId: clip.id,
        assetId: clip.props.assetId,
        startSample: sampleForTime(Math.max(rangeStart, Number(clip.props.start ?? 0)), rate),
        endSample: sampleForTime(Math.min(rangeEnd, clipEnd(clip)), rate),
        sourceInSample: sampleForTime(Number(clip.props.inPoint ?? 0), rate),
        playbackRate: Number(clip.props.playbackRate ?? 1),
        gainDb: Number(clip.props.gainDb ?? 0),
        pan: Number(clip.props.pan ?? 0),
        fadeIn: Number(clip.props.fadeIn ?? 0),
        fadeOut: Number(clip.props.fadeOut ?? 0),
      })),
  };
}

export function audioScheduleForClip(clip, timelineStart = 0) {
  const start = Number(clip.props.start ?? 0);
  const end = clipEnd(clip);
  const cursor = Math.max(0, Number(timelineStart) || 0);
  if (end <= cursor) return null;
  const playbackRate = Number(clip.props.playbackRate ?? 1);
  const elapsedTimeline = Math.max(0, cursor - start);
  const scheduleDelay = Math.max(0, start - cursor);
  const outputDuration = Math.max(0, Number(clip.props.duration ?? 0) - elapsedTimeline);
  return {
    clipId: clip.id,
    assetId: clip.props.assetId,
    delay: scheduleDelay,
    sourceOffset: Number(clip.props.inPoint ?? 0) + elapsedTimeline * playbackRate,
    sourceDuration: outputDuration * playbackRate,
    outputDuration,
    playbackRate,
    gainDb: Number(clip.props.gainDb ?? 0),
    pan: Number(clip.props.pan ?? 0),
    fadeIn: Number(clip.props.fadeIn ?? 0),
    fadeOut: Number(clip.props.fadeOut ?? 0),
    clipStart: start,
    clipEnd: end,
  };
}
