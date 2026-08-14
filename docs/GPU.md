# GPU composition

## Texture lifetime

Decoded `VideoFrame`s are copied into persistent `GPUTexture`s behind a byte/entry bounded LRU. Evicted textures are destroyed explicitly. This avoids caching `GPUExternalTexture`, whose lifetime remains tied to the source frame.

## Multi-layer path

`GpuLayerCompositor` renders six vertices per source-backed item. Vertex geometry reproduces the Canvas2D contract:

- cropped source rectangle;
- composition-centred x/y;
- cropped source size × scaleX/scaleY;
- anchor-relative rotation;
- per-layer opacity.

The fragment path applies brightness, contrast, saturation, hue and bounded approximate blur. Normal alpha blending composites layers in evaluated order.

## Fallback

GPU eligibility is all-or-nothing for the current plan. Text, shapes, unsupported effects or non-normal blend modes use Canvas2D. Separate WebGPU/Canvas surfaces keep that fallback valid after context acquisition.

## Color boundary

WebGPU texture values are raw numeric data. Media therefore treats external-image copy color space as an explicit boundary, not texture metadata. The default texture cache targets SDR sRGB numeric encoding.

PQ/HLG `VideoFrame`s are rejected by the default 8-bit GPU policy unless an explicit HDR tone-map/float policy is configured. This is intentional: silently clamping HDR values into rgba8unorm would be a fidelity bug.

0.9 includes deterministic SDR RGB-primary/transfer conversion primitives for conformance and future shader use, but it does not claim a complete HDR color-management pipeline.
