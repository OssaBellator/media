# MPEG-TS reference kernel

0.13 adds a modular 188-byte MPEG-TS path for legacy HLS and transport-stream ingest.

```text
188-byte packets
  -> adaptation / continuity / PCR
  -> PAT / PMT
  -> PES reconstruction
  -> PTS / DTS unwrap
  -> H.264/H.265 or AAC access units
  -> bounded segment session
```

The demuxer keeps timestamp unwrap state across segments. An HLS discontinuity resets that epoch deliberately. Transport scrambling raises `ERR_ENCRYPTED_MEDIA`; whole-segment HLS AES-128 should already have been handled by the adaptive acquisition layer.

H.264 SPS parsing supplies coded width/height and a concrete `avc1.PPCCLL` string. AAC/ADTS is stripped to raw AAC frames and carries a two-byte AudioSpecificConfig.

Current limits: 188-byte TS only; PSI CRC is not validated; H.265 parameter-set metadata is shallow; LATM/MP3/AC-3/E-AC-3 are typed but not all reframed into decoder-ready chunks; no DVB subtitle/teletext/SCTE-35 interpretation yet.
