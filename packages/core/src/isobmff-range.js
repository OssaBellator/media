import { createDemuxPlan } from './media-kernel.js';
import { parseFtyp, parseIsoBoxes, parseMvhd } from './isobmff.js';
import { isoChild, isoChildren, parseIsoTrack } from './isobmff-tables.js';
import { applyIsoEditList, parseElst } from './isobmff-edits.js';
import { parseTkhdRotation, parseVideoSampleMetadata } from './isobmff-metadata.js';
import { demuxIsoBmff } from './isobmff-demux.js';
import { assertRangeSource, readRange } from './range-source.js';

function ascii(bytes, offset, length) { let value = ''; for (let index = 0; index < length; index += 1) value += String.fromCharCode(bytes[offset + index]); return value; }
function u64(view, offset) { const value = (BigInt(view.getUint32(offset, false)) << 32n) | BigInt(view.getUint32(offset + 4, false)); if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('64-bit ISO-BMFF size exceeds safe integer range'); return Number(value); }
function parseTrackEdits(view, trak) { const edts = isoChild(view, trak, 'edts'); if (!edts) return null; const elst = isoChild(view, edts, 'elst'); return elst ? parseElst(view, elst) : null; }
function chunkEnd(chunk) { return Number(chunk.offset ?? 0) + Number(chunk.byteLength ?? 0); }

export async function scanIsoTopLevelSource(source, { signal, maxBoxes = 4096 } = {}) {
  const target = assertRangeSource(source);
  const boxes = [];
  let offset = 0;
  let logicalBytesRead = 0;
  while (offset < target.size) {
    if (boxes.length >= maxBoxes) throw new Error(`ISO-BMFF top-level box limit exceeded (${maxBoxes})`);
    const remaining = target.size - offset;
    if (remaining < 8) throw new Error('Trailing truncated ISO-BMFF bytes');
    const headerLength = Math.min(16, remaining);
    const header = await readRange(target, offset, headerLength, { signal });
    logicalBytesRead += headerLength;
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    let size = view.getUint32(0, false);
    const type = ascii(header, 4, 4);
    let headerSize = 8;
    if (size === 1) {
      if (header.byteLength < 16) throw new Error(`Truncated extended-size box ${type}`);
      size = u64(view, 8);
      headerSize = 16;
    } else if (size === 0) size = remaining;
    if (!Number.isSafeInteger(size) || size < headerSize || offset + size > target.size) throw new Error(`Invalid ISO-BMFF box ${type}`);
    boxes.push({ type, offset, size, headerSize, dataOffset: offset + headerSize, dataSize: size - headerSize, end: offset + size });
    offset += size;
  }
  return { boxes, bytesRead: logicalBytesRead, sourceSize: target.size };
}

export async function readIsoSourceBox(source, box, { signal } = {}) {
  if (!box || !Number.isInteger(Number(box.offset)) || !Number.isInteger(Number(box.size))) throw new Error('ISO-BMFF source box requires offset and size');
  return readRange(source, Number(box.offset), Number(box.size), { signal });
}

export function demuxClassicIsoMoov(moovBytes, { container = 'mp4', brands = null, topLevelBoxes = [], sourceSize = null, applyEditLists = true, indexBytesRead = null } = {}) {
  const view = moovBytes instanceof DataView ? moovBytes : new DataView(moovBytes.buffer ?? moovBytes, moovBytes.byteOffset ?? 0, moovBytes.byteLength ?? undefined);
  const top = parseIsoBoxes(view);
  const moov = top.find((box) => box.type === 'moov');
  if (!moov) throw new Error('ISO-BMFF moov box not found in range payload');
  const movieBox = isoChild(view, moov, 'mvhd');
  const movie = movieBox ? parseMvhd(view, movieBox) : null;
  const trakBoxes = isoChildren(view, moov).filter((box) => box.type === 'trak');
  const parsedTracks = trakBoxes.map((trak) => {
    const parsed = parseIsoTrack(view, trak);
    if (!parsed) return null;
    const editList = parseTrackEdits(view, trak);
    if (parsed.track.type === 'video') {
      Object.assign(parsed.track, parseVideoSampleMetadata(view, parsed.descriptions?.[0]?.nested ?? []));
      const tkhd = isoChild(view, trak, 'tkhd');
      parsed.track.rotation = tkhd ? parseTkhdRotation(view, tkhd) : 0;
    }
    return { ...parsed, editList };
  }).filter(Boolean);
  if (!parsedTracks.length) throw new Error('No supported audio/video tracks found in moov');
  const tracks = parsedTracks.map((item) => item.track);
  let chunks = parsedTracks.flatMap((item) => item.chunks);
  if (sourceSize != null) {
    const invalid = chunks.find((chunk) => Number(chunk.offset) < 0 || chunkEnd(chunk) > sourceSize);
    if (invalid) throw new Error(`Sample ${invalid.trackId}:${invalid.sequence ?? 0} points outside source`);
  }
  const editLists = {};
  if (applyEditLists && movie?.timescale) {
    for (const item of parsedTracks) {
      if (!item.editList?.entries?.length) continue;
      const own = chunks.filter((chunk) => chunk.trackId === item.track.id);
      try {
        const adjusted = applyIsoEditList(own, item.editList, { movieTimescale: movie.timescale, mediaTimescale: item.mdhd.timescale });
        chunks = [...chunks.filter((chunk) => chunk.trackId !== item.track.id), ...adjusted];
        editLists[item.track.id] = { applied: true, entries: item.editList.entries };
      } catch (error) {
        editLists[item.track.id] = { applied: false, entries: item.editList.entries, reason: error.message };
      }
    }
    chunks.sort((a, b) => Number(a.decodeTimestamp ?? a.timestamp) - Number(b.decodeTimestamp ?? b.timestamp) || String(a.trackId).localeCompare(String(b.trackId)) || Number(a.sequence ?? 0) - Number(b.sequence ?? 0));
  }
  const seekPoints = [...new Set(chunks.filter((chunk) => chunk.type === 'key' && tracks.find((track) => track.id === chunk.trackId)?.type === 'video').map((chunk) => Number(chunk.presentationTimestamp ?? chunk.timestamp) / 1_000_000))].sort((a, b) => a - b);
  const duration = movie?.durationSeconds || Math.max(...tracks.map((track) => track.duration), ...chunks.map((chunk) => (Number(chunk.presentationTimestamp ?? chunk.timestamp) + Number(chunk.duration ?? 0)) / 1_000_000), 0);
  const plan = createDemuxPlan({ container, duration, tracks, seekPoints, metadata: { brands, topLevelBoxes, sampleCount: chunks.length, fragmented: false, editLists, rangeIndexed: true, indexBytesRead } });
  return { ...plan, chunks, trackDetails: parsedTracks.map(({ track, tkhd, mdhd, descriptions, classicReady, editList }) => ({ id: track.id, tkhd, mdhd, descriptions, classicReady, editList, rotation: track.rotation, colorSpace: track.colorSpace, pixelAspectRatio: track.pixelAspectRatio, contentLightLevel: track.contentLightLevel, masteringDisplay: track.masteringDisplay })) };
}

export async function demuxIsoBmffSource(source, { container = 'mp4', applyEditLists = true, signal, fragmentedFallbackMaxBytes = 256 * 1024 * 1024 } = {}) {
  const target = assertRangeSource(source);
  const scan = await scanIsoTopLevelSource(target, { signal });
  const moov = scan.boxes.find((box) => box.type === 'moov');
  if (!moov) throw new Error('ISO-BMFF moov box not found');
  const fragmented = scan.boxes.some((box) => box.type === 'moof');
  if (fragmented) {
    if (target.size > fragmentedFallbackMaxBytes) throw new Error(`Fragmented MP4 range indexing is not implemented for sources above ${fragmentedFallbackMaxBytes} bytes`);
    const bytes = await readRange(target, 0, target.size, { signal });
    const result = demuxIsoBmff(bytes, { container, applyEditLists });
    return { ...result, metadata: { ...result.metadata, rangeIndexed: false, rangeFallback: 'fragmented-full-read', indexBytesRead: target.size } };
  }
  const ftyp = scan.boxes.find((box) => box.type === 'ftyp');
  let brands = null;
  let indexBytesRead = scan.bytesRead;
  if (ftyp) {
    const bytes = await readIsoSourceBox(target, ftyp, { signal });
    indexBytesRead += bytes.byteLength;
    const box = parseIsoBoxes(bytes)[0];
    brands = parseFtyp(bytes, box);
  }
  const moovBytes = await readIsoSourceBox(target, moov, { signal });
  indexBytesRead += moovBytes.byteLength;
  return demuxClassicIsoMoov(moovBytes, { container, brands, topLevelBoxes: scan.boxes.map(({ type, offset, size }) => ({ type, offset, size })), sourceSize: target.size, applyEditLists, indexBytesRead });
}

export async function readIsoSampleFromSource(source, sample, { signal } = {}) {
  if (sample?.offset == null || sample?.byteLength == null) throw new Error('Sample requires offset and byteLength');
  return readRange(source, Number(sample.offset), Number(sample.byteLength), { signal });
}
