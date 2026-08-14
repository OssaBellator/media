# GPU render graph

0.10 moves beyond one-pass source layering into an explicit render graph.

## Supported reference graph

- source-backed image/video layers;
- rasterized text and vector-shape inputs;
- alpha masks without feathering;
- crossfade, left/right wipe and dip-style transitions;
- brightness, contrast, saturation, hue and blur;
- normal, multiply, screen, overlay, add, darken and lighten blends;
- source transforms/crop/anchor/opacity;
- `rgba16float` ping-pong working targets;
- final output transfer/tone-map pass.

Blend modes sample both the accumulated destination and the new layer, rather than pretending fixed-function alpha blending implements multiply/screen/etc.

## HDR policy

Core provides PQ/HLG transfer functions and ACES/Reinhard/Hable/clip tone maps. HDR requires a float working target and an explicit tone-map policy. Browser external-image ingestion is capability-gated: if the engine cannot guarantee the source frame entered the working space with correct HDR semantics, it must fall back or use an injected upload path rather than silently clamp through 8-bit SDR.
