# Cut playback runtime

## Contract

Cut playback is a consumer of timeline semantics, not a second timeline implementation. The browser runtime reads the current transport time, finds the top active unmuted visual clip, converts timeline time to source time, and requests that frame from `CutPlaybackEngine`.

## Decode path

1. load the persisted source Blob by asset id;
2. demux MP4/MOV or WebM to normalized tracks/chunks;
3. create the decoder-independent seek index;
4. find a preceding keyframe and directional decode window;
5. compact only those encoded byte ranges into a Worker-transferable buffer;
6. run `decode-video` with `stream:true`;
7. receive each `VideoFrame` in a transferable kernel progress message;
8. cache a bounded number of decoded frames;
9. present through WebGPU or Canvas2D.

The frame cache closes evicted frames. A source hash/identity change invalidates the source's demux and decoded state.

## Prefetch

Foreground seeks use high priority. A smaller-priority forward/backward request follows the playhead. The existing Worker pool deduplicates matching keyed windows and cancellation clears work when assets change or the playback service closes.

## Current integration boundary

The original HTML media element remains as a compatibility fallback. The 0.8 runtime follows the Studio transport as exposed by the current UI and renders the **top active video clip**. It does not yet ask the full composition evaluator for every overlapping visual item, so multi-layer Cut playback still needs a composition-aware GPU scheduler.
