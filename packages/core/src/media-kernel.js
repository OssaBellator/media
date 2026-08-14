const CONTAINERS = new Set(["mp4", "mov", "webm", "wav", "mp3", "ogg", "unknown"]);
const TRACK_TYPES = new Set(["video", "audio", "data"]);
const CHUNK_TYPES = new Set(["key", "delta"]);

function finite(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be finite`);
  return parsed;
}
function positive(value, label) {
  const parsed = finite(value, label);
  if (parsed <= 0) throw new Error(`${label} must be positive`);
  return parsed;
}
function string(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

export function secondsToMicros(seconds) { return Math.round(finite(seconds, "seconds") * 1_000_000); }
export function microsToSeconds(micros) { return finite(micros, "microseconds") / 1_000_000; }

export function sniffContainer({ mimeType = "", name = "", bytes } = {}) {
  const mime = String(mimeType).toLowerCase();
  const lower = String(name).toLowerCase();
  if (mime.includes("webm") || lower.endsWith(".webm")) return "webm";
  if (mime.includes("quicktime") || lower.endsWith(".mov")) return "mov";
  if (mime.includes("mp4") || /\.(mp4|m4v|m4a)$/.test(lower)) return "mp4";
  if (mime.includes("wav") || lower.endsWith(".wav")) return "wav";
  if (mime.includes("mpeg") || lower.endsWith(".mp3")) return "mp3";
  if (mime.includes("ogg") || /\.(ogg|oga|ogv)$/.test(lower)) return "ogg";
  const data = bytes instanceof Uint8Array ? bytes : bytes ? new Uint8Array(bytes) : null;
  if (data?.length >= 12) {
    const ascii = (start, end) => String.fromCharCode(...data.slice(start, end));
    if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "wav";
    if (ascii(4, 8) === "ftyp") return "mp4";
    if (data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3) return "webm";
    if (ascii(0, 4) === "OggS") return "ogg";
  }
  return "unknown";
}

export function createTrackDescriptor({ id, type, codec, timescale = 1_000_000, duration = 0, width, height, sampleRate, channels, description = null, language = null } = {}) {
  const trackType = string(type, "track type");
  if (!TRACK_TYPES.has(trackType)) throw new Error(`Unsupported track type: ${trackType}`);
  const result = {
    id: string(id, "track id"), type: trackType, codec: string(codec, "codec"),
    timescale: positive(timescale, "timescale"), duration: Math.max(0, finite(duration, "duration")),
    description, language,
  };
  if (trackType === "video") {
    result.width = Math.max(1, Math.round(positive(width, "video width")));
    result.height = Math.max(1, Math.round(positive(height, "video height")));
  }
  if (trackType === "audio") {
    result.sampleRate = Math.max(1, Math.round(positive(sampleRate, "audio sampleRate")));
    result.channels = Math.max(1, Math.round(positive(channels, "audio channels")));
  }
  return result;
}

export function createDemuxPlan({ container = "unknown", duration = 0, tracks = [], seekPoints = [], metadata = {} } = {}) {
  if (!CONTAINERS.has(container)) throw new Error(`Unsupported container: ${container}`);
  if (!Array.isArray(tracks) || !tracks.length) throw new Error("Demux plan requires at least one track");
  const ids = new Set();
  for (const track of tracks) {
    if (!track?.id || ids.has(track.id)) throw new Error(`Duplicate or missing track id: ${track?.id ?? ""}`);
    ids.add(track.id);
  }
  const durationValue = Math.max(0, finite(duration, "duration"));
  const points = [...new Set(seekPoints.map((value) => Math.max(0, finite(value, "seek point"))).filter((value) => value <= durationValue || durationValue === 0))].sort((a, b) => a - b);
  return { version: 1, container, duration: durationValue, tracks: structuredClone(tracks), seekPoints: points, metadata: structuredClone(metadata) };
}

export function decoderConfigForTrack(track) {
  if (!track || !TRACK_TYPES.has(track.type)) throw new Error("Invalid track descriptor");
  if (track.type === "video") return { codec: track.codec, codedWidth: track.width, codedHeight: track.height, description: track.description ?? undefined };
  if (track.type === "audio") return { codec: track.codec, sampleRate: track.sampleRate, numberOfChannels: track.channels, description: track.description ?? undefined };
  return { codec: track.codec, description: track.description ?? undefined };
}

export function createEncodedChunkDescriptor({ trackId, type = "delta", timestamp, duration = 0, byteLength = 0, offset = null, sequence = 0 } = {}) {
  if (!CHUNK_TYPES.has(type)) throw new Error(`Unsupported chunk type: ${type}`);
  return {
    trackId: string(trackId, "trackId"), type,
    timestamp: Math.max(0, Math.round(finite(timestamp, "timestamp"))),
    duration: Math.max(0, Math.round(finite(duration, "duration"))),
    byteLength: Math.max(0, Math.round(finite(byteLength, "byteLength"))),
    offset: offset == null ? null : Math.max(0, Math.round(finite(offset, "offset"))),
    sequence: Math.max(0, Math.round(finite(sequence, "sequence"))),
  };
}

export function assertEncodedChunkSequence(chunks, { requireInitialKeyframe = false } = {}) {
  if (!Array.isArray(chunks)) throw new Error("chunks must be an array");
  const byTrack = new Map();
  for (const chunk of chunks) {
    const value = createEncodedChunkDescriptor(chunk);
    const previous = byTrack.get(value.trackId);
    if (previous && value.timestamp < previous.timestamp) throw new Error(`Non-monotonic timestamps for track ${value.trackId}`);
    if (previous && value.sequence <= previous.sequence) throw new Error(`Non-increasing sequence for track ${value.trackId}`);
    byTrack.set(value.trackId, value);
  }
  if (requireInitialKeyframe) {
    const firstByTrack = new Map();
    for (const chunk of chunks) if (!firstByTrack.has(chunk.trackId)) firstByTrack.set(chunk.trackId, chunk);
    for (const [trackId, first] of firstByTrack) if (first.type !== "key") throw new Error(`Track ${trackId} does not begin with a key chunk`);
  }
  return chunks;
}

export function chunkWindow(chunks, { start = 0, end = Infinity, preroll = 0, trackId } = {}) {
  const startMicros = Math.max(0, secondsToMicros(start));
  const endMicros = end === Infinity ? Infinity : Math.max(startMicros, secondsToMicros(end));
  const prerollMicros = Math.max(0, secondsToMicros(preroll));
  const filtered = chunks.filter((chunk) => (!trackId || chunk.trackId === trackId) && chunk.timestamp < endMicros && chunk.timestamp + chunk.duration >= Math.max(0, startMicros - prerollMicros));
  if (!filtered.length || !trackId) return filtered;
  const firstIndex = chunks.indexOf(filtered[0]);
  for (let index = firstIndex; index >= 0; index -= 1) {
    const chunk = chunks[index];
    if (chunk.trackId === trackId && chunk.type === "key" && chunk.timestamp <= startMicros) return chunks.slice(index).filter((item) => item.trackId === trackId && item.timestamp < endMicros);
  }
  return filtered;
}

export class DemuxerRegistry {
  constructor() { this.entries = new Map(); }
  register(id, adapter) {
    string(id, "demuxer id");
    if (!adapter || typeof adapter.probe !== "function" || typeof adapter.create !== "function") throw new Error("Demuxer adapter requires probe and create functions");
    this.entries.set(id, adapter); return this;
  }
  unregister(id) { return this.entries.delete(id); }
  async probe(source) {
    const results = [];
    for (const [id, adapter] of this.entries) {
      const score = Number(await adapter.probe(source));
      if (Number.isFinite(score) && score > 0) results.push({ id, score, adapter });
    }
    return results.sort((a, b) => b.score - a.score);
  }
  async create(source, options = {}) {
    const [match] = await this.probe(source);
    if (!match) throw new Error("No registered demuxer supports this source");
    return match.adapter.create(source, options);
  }
}
