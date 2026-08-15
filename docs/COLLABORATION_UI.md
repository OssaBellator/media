# Collaboration resolution UI boundary

`apps/studio/collaboration-resolution-view.js` renders the sanitized collaboration conflict model plus immutable decision draft into Studio-compatible HTML without acquiring mutation authority.

The renderer escapes every actor/key ID, transaction label, operation summary and resource label before interpolation. It exposes exactly three decisions per remote-operation group: `keep-local`, `reapply-remote` and `manual`. Local conflicting edit summaries and affected resource/property labels are shown, while operation patch values and the signed batch signature are never rendered.

Truncated conflict sets display an alert and cannot advance to intent review. Complete sets remain disabled until every remote-operation group has an explicit decision. Dataset helpers delegate decisions to the core immutable decision API and reject unsupported choices.

This module is deliberately a visual foundation only. It does not refresh state, construct replacement transactions, sign a batch, submit transport requests or apply any edit. Those remain separate authenticated/editor boundaries.

## Resolution session

`apps/studio/collaboration-resolution-session.js` owns the ephemeral `{ model, draft }` lifecycle for a visible conflict. It creates the immutable decision draft, renders through the safe view helper, applies only validated decision choices, and finalizes to the payload-free resolution intent through an injected callback.

The session has no graph, signing key, transport client or mutation callback. A failed finalization callback leaves the chosen draft intact for retry/review, and `close()` prevents further rendering, choices or finalization. This keeps UI state ownership separate from any future transaction reconstruction/signing workflow.
