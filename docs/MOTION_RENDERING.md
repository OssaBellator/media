# Motion rendering reference

Media separates **motion-blur intent** from **sample-count fidelity**. A quality controller may choose how many samples are affordable, but it cannot turn motion blur on by itself.

## Composition shutter policy

New compositions store motion blur as graph state:

- `motionBlurEnabled` — false by default;
- `shutterAngle` — default 180 degrees;
- `shutterPhase` — centered, leading or trailing;
- `motionBlurWeightCurve` — box, triangle or cosine.

Evaluation normalizes these properties into `plan.motionBlur` and carries the composition FPS into the render plan.

## Temporal sampling

`createMotionBlurSamples()` converts output time, frame rate, shutter angle and sample count into weighted subframe times. `temporalSamplesForFidelity()` applies the composition policy and collapses to one center sample when blur is disabled, the shutter is closed or fidelity requests one sample.

`renderTemporalCompositionToCanvas2D()` is the executable reference compositor. It reuses the already-evaluated center plan, evaluates only additional shutter times, renders each subframe through the normal composition renderer and resolves the result with `accumulateTemporalFrames()`.

This reference implementation reads back 8-bit RGBA Canvas2D frames. A scene-linear `rgba16float` GPU temporal resolve, optical-flow blur and motion-vector acceleration remain future work.

`compileTemporalGpuRenderGraph()` remains the render-graph description for a future direct WebGPU multi-sample implementation.

## Vector mattes

`vector-matte.js` provides even-odd/nonzero point-in-path testing, signed distance to polygon/path edges, deterministic supersampled alpha rasterization, feather radius and inversion.

0.15 connects the fidelity controller to that rasterizer: vector masks consume a 1–4x supersample level during actual Canvas/WebGPU mask preparation. Source-backed WebGPU vector masks are materialized into source-sized synthetic mask textures; Canvas2D uses the same deterministic matte kernel directly.
