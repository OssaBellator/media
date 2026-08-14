# Offline audio, automation and loudness

## Automation

Automation curves are persistent numeric points with linear, hold, ease-in, ease-out and ease-in-out interpolation. Core helpers emit normal graph operations for clip gain/pan and output master-gain automation, preserving the same mutation boundary used elsewhere in Media.

`renderAutomatedMix` evaluates automation in sample time while applying source in-points, source/output sample-rate conversion, playback rate, gain, constant-power pan and fades.

## Loudness

The reference analyzer:

- resamples analysis to 48 kHz;
- applies the BS.1770 K-weighting pre-filter and RLB stage;
- evaluates 400 ms blocks at 100 ms steps by default;
- applies the -70 LUFS absolute gate and -10 LU relative gate;
- uses standard 5.1/7.1 surround weighting defaults with LFE excluded;
- reports sample peak and a 4× windowed-sinc intersample peak estimate;
- can derive gain toward a target integrated loudness while respecting a configured peak ceiling.

## Accuracy boundary

The implementation is deterministic and useful for product development/export normalization, but it is not presented as a certified EBU R128/ATSC meter. The intersample estimator is not a standards-certified true-peak filter, channel-layout metadata is still minimal, and the current offline browser path materializes the final PCM mix before loudness normalization.
