# Motion rendering reference

0.12 adds temporal and vector correctness kernels without pretending they are all real-time optimized.

## Temporal sampling

`createMotionBlurSamples()` converts output time, frame rate, shutter angle and sample count into weighted subframe times. Centered, leading and trailing shutter phases are supported, along with box/triangle/cosine weighting.

`rollingShutterOffset()` adds row-dependent readout time. `compileTemporalGpuRenderGraph()` expands a supported composition graph into per-sample passes plus weighted accumulation/resolve nodes.

`accumulateTemporalFrames()` is a deterministic CPU oracle for the final weighted pixel result.

## Vector mattes

`vector-matte.js` provides:

- even-odd/nonzero point-in-path testing;
- signed distance to polygon/path edges;
- deterministic supersampled alpha rasterization;
- feather radius and inversion.

This gives Canvas/Deliver tests a reference matte. A dedicated GPU vector/SDF rasterizer and motion-vector optical-flow blur remain future optimization work.
