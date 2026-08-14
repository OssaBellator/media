# GPU render graph

The WebGPU reference graph uses destination-sampled composition rather than treating fixed-function alpha as a universal blend implementation.

## Supported reference graph

- image/video source layers;
- rasterized text and vector-shape inputs;
- alpha or luma masks;
- approximate feathered-mask sampling;
- crossfade, left/right wipe and dip-style transitions;
- brightness, contrast, saturation, hue and blur;
- normal, multiply, screen, overlay, add, darken and lighten blends;
- source transforms/crop/anchor/opacity;
- `rgba16float` ping-pong working targets;
- final output transfer/tone-map pass.

## HDR ingest

There are two deliberately distinct upload paths:

1. ordinary browser `VideoFrame`/external-image upload, where browser conversion behavior is treated as browser-managed rather than assumed scene-linear;
2. `linear-rgba16` frames supplied by an injected native/WASM backend, uploaded directly to an `rgba16float` texture.

Linear HDR frames carry a declared source peak and cannot be presented by the GPU compositor without an explicit tone-map policy. Core provides PQ/HLG transfer helpers and ACES/Reinhard/Hable/clip reference tone maps.

This is still a reference color pipeline. OS display calibration, ICC/ColorSync/Windows advanced-color integration and guaranteed HDR swap-chain presentation belong in platform backends.
