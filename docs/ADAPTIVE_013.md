# Adaptive timing extensions — 0.13

0.13 is additive to the 0.12 HLS/DASH model.

`AdaptiveMediaSession` chooses CMAF or MPEG-TS from the segment bytes that arrived. CMAF continues through `CmafSegmentSession`; TS uses `MpegTsSegmentSession`.

`dash-v2.js` focuses on period-correct SegmentTemplate timing: period windows are inferred before segment expansion, representation IDs are period-qualified, sequence-number restarts do not collide, and UTCTiming can correct the wall clock before dynamic availability is calculated.

`DashStreamSessionV2` supports direct, HTTP HEAD and HTTP xsdate/ISO clock sources, active-period ABR choice and representation-family preference across period transitions.

The v2 layer does not replace the broader 0.12 SegmentList/SegmentBase/sidx parser. They intentionally coexist until the models can be unified without regressing mature range-index paths.
