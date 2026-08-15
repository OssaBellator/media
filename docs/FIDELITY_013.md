# Adaptive render fidelity

`FidelityController` budgets interactive quality against frame time. Scrubbing uses one temporal sample and one vector supersample. Preview/playback adapts requested temporal/vector quality using an EWMA render-cost estimate plus stale-frame pressure. Export returns the requested reference quality unchanged.

`resolveCompositionFps()` first checks an explicit FPS, then the evaluated plan's `compositionId` in the graph, then plan/default values. It does not depend on a node `kind` marker.

`FidelityPlaybackEngine` is an additive orchestration adapter. It calls the normal composition evaluator, computes a fidelity plan, passes that plan to a render callback and records duration/staleness after presentation. Existing playback remains available when fidelity scheduling is not enabled.
