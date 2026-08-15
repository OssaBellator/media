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

## Display policy

0.12 separates **source HDR metadata**, **working-space choice** and **display capability**. `chooseDisplayPipeline()` selects SDR/HDR mode, working format, output transfer/gamut and tone-map requirements. `detectBrowserDisplayCapabilities()` derives an advisory browser profile from CSS dynamic-range/color-gamut queries; native targets can supply authoritative capabilities.

`createPolicyGpuCompositionRenderer()` applies that policy when constructing the browser compositor.

## Temporal rendering

`compileTemporalGpuRenderGraph()` expands a normal supported graph into weighted subframe passes and a temporal resolve node. The CPU `accumulateTemporalFrames()` implementation remains the deterministic reference result.

Normal Cut playback now uses `BrowserGpuCompositionRenderer.presentTemporal()` for supported **SDR** temporal plans. Each shutter sample is evaluated independently, including per-sample vector-mask adaptation, rendered through the existing GPU graph into a floating-point `rgba16float` scratch target, converted back to linear light in `GpuTemporalAccumulator`, and combined with normalized additive sample weights. The accumulated linear result is converted to the canvas transfer once after all samples. Because the intermediate sample target is floating point, this avoids an 8-bit readback/quantization step while preserving the existing graph compositor and deterministic Canvas2D fallback.

Tone-mapped/HDR temporal plans deliberately remain on the Canvas/reference path for now. The next GPU fidelity step is to expose the graph compositor's pre-final linear working texture so HDR temporal accumulation can happen before tone mapping without the SDR transfer round-trip.

## HDR ingest

There are two deliberately distinct upload paths:

1. ordinary browser `VideoFrame`/external-image upload, where browser conversion behavior is treated as browser-managed rather than assumed scene-linear;
2. `linear-rgba16` frames supplied by an injected native/WASM backend, uploaded directly to an `rgba16float` texture.

Linear HDR frames carry a declared source peak and cannot be presented by the GPU compositor without an explicit tone-map policy. Core provides PQ/HLG transfer helpers and ACES/Reinhard/Hable/clip reference tone maps.

OS display calibration, ICC/ColorSync/Windows advanced-color integration and guaranteed HDR swap-chain presentation remain platform-backend work.
