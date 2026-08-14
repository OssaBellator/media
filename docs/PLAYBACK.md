# Playback

Cut consumes the evaluated composition, not a UI-selected clip.

Source-backed video decode uses range IO, keyframe-safe encoded windows, Worker scheduling and codec routing. Classic MP4, common fMP4 and WebM can avoid file-sized source buffers. The composition renderer uses latest-generation commit semantics so stale asynchronous seeks cannot paint over newer frames.

The GPU reference path now represents blend/mask/transition/intrinsic nodes; unsupported masks/effects/color ingestion fall back instead of changing creative semantics silently.
