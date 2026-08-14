# GPU frame and effect runtime

## Frame texture cache

`GpuFrameTextureCache` copies decoded frame pixels into persistent `rgba8unorm` textures using `copyExternalImageToTexture`. Cache entries have both count and approximate byte limits and use recency for eviction. Eviction explicitly destroys the texture.

Persistent textures are used instead of caching `GPUExternalTexture` because external texture lifetime is tied to the media source/frame.

## Effect pass

`GpuEffectPipeline` uses a fullscreen triangle and one uniform block. The current reference shader implements:

- brightness;
- contrast;
- saturation;
- hue rotation;
- opacity;
- an approximate 8-neighbour blur.

Cut's WebCodecs playback surface uses this path when WebGPU initializes successfully. Canvas2D uses equivalent CSS-filter operations as fallback.

## Boundary

This is the beginning of the GPU evaluator, not yet a full composition renderer. Transforms, masks, blend modes, multiple overlapping decoded sources, color transforms and high-quality separable/convolution effects should become explicit GPU passes/render-graph nodes rather than expanding one monolithic shader indefinitely.
