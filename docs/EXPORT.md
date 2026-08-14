# Export and derived-media paths

## Goal

Deliver should not invent a second rendering model. It converts evaluated project state into encoded media using the same kernel contracts used for preview and derivatives.

## Classic MP4/MOV

`muxMp4(plan)` currently targets the common browser/native interchange path:

- video: AVC/H.264 sample entries `avc1` or `avc3` with an `avcC` decoder description;
- audio: AAC `mp4a.40.*` with AudioSpecificConfig embedded in `esds`;
- one MP4 chunk per encoded sample, allowing simple deterministic `stsc` and exact source offsets;
- decode durations in `stts`;
- composition offsets in version-0/1 `ctts`;
- keyframes in `stss`;
- fast-start layout: `ftyp` → `moov` → `mdat`;
- `co64` is selected if offsets exceed 32-bit range, although the current in-memory writer intentionally rejects output larger than 4 GiB.

Classic sample tables do not store an absolute first DTS. If a mux track starts after movie time zero, Media normalizes media decode time to zero and writes a leading empty `edts/elst` edit so presentation timing survives a mux/demux round trip.

`mdhd` uses version 1 for long tracks when a 32-bit duration at the current 1,000,000-timescale would overflow.

### Current MP4 limitations

- AVC + AAC are the supported classic writer codecs today;
- 96 kHz+ AAC is rejected rather than emitting an invalid version-0 `mp4a` rate field;
- HEVC/AV1 MP4 sample entries are not yet emitted;
- the writer is in-memory, not a streaming file sink;
- sample groups, metadata tracks, subtitles, color/HDR boxes and advanced brand policy are not yet implemented.

## Fragmented MP4

`createFragmentedMp4Init(plan)` emits `ftyp + moov` with empty sample tables and `mvex/trex` defaults.

`createFragmentedMp4Segment(plan)` emits:

```text
moof
  mfhd
  traf
    tfhd   (default-base-is-moof)
    tfdt   (64-bit base decode time)
    trun   (duration, size, flags, composition offset, data offset)
mdat
```

Track payloads are contiguous in `mdat`, and each `trun` points at its track's first payload byte. This is enough for deterministic local fMP4 segments; streaming manifests and segment indexes are later work.

## WebM

The existing writer remains the preferred open browser proxy path. It supports VP8/VP9/AV1 plus Opus/Vorbis, writes clusters and keyframe Cues, and is round-trip tested through Media's own WebM demuxer.

## Encoder-result bridge

`createMuxPlanFromEncoded()` converts WebCodecs encoder results directly into the semantic mux layer. It preserves:

- codec identifiers;
- dimensions or audio layout;
- `decoderConfig.description` bytes required by container sample entries;
- timestamps/DTS/duration;
- keyframe state;
- encoded payload bytes.

This is the intended boundary for Deliver:

```text
rendered frames / audio data
       ↓
WebCodecs or native encoder
       ↓
encoded stream records
       ↓
createMuxPlanFromEncoded
       ↓
WebM / MP4 / fMP4 writer
       ↓
Deliver artifact
```

## Thumbnails

Thumbnail generation is now executable rather than planning-only:

1. use the seek index to choose the preceding safe keyframe;
2. decode a small forward window;
3. choose the decoded frame nearest the requested time;
4. resize on OffscreenCanvas/Canvas2D;
5. encode with `convertToBlob`/`toBlob`.

The generated Blob can be written directly to the existing IndexedDB derived-artifact store.

## Proxy transcode

The browser proxy path currently performs:

```text
source bytes
  → demuxed video/audio chunks
  → WebCodecs decode
  → video resize
  → VP9 or AV1 encode
  → optional Opus audio encode
  → WebM mux
  → derived artifact
```

The first implementation is intentionally batch-based. To prevent unbounded frame retention, proxy tasks have explicit decoded video/audio frame caps and ask callers to segment larger work. A later streaming transcode pipeline should feed decoder output into the encoder incrementally and persist segments as they complete.

## Next export work

1. streaming MP4/WebM sinks instead of full in-memory files;
2. HEVC and AV1 MP4 sample entries/configuration;
3. color metadata, HDR signaling and rotation/pixel-aspect boxes;
4. segmented proxy jobs with resumability in the derived store;
5. Studio Deliver integration for full timeline render → encoder → mux;
6. offline audio automation and loudness analysis;
7. real-world codec/container conformance fixtures.
