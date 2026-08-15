# Creative OS architecture

Media is organized around one canonical project graph. Specialized workspaces are projections over that graph; they are not separate document formats or application-specific state stores.

The architectural rule is simple:

> Durable creative state belongs in the graph and changes through validated operations.

Binary media payloads, decoder state, GPU resources, model request payloads, caches, and transport state may be ephemeral. Their durable identities and relationships belong in the graph.

## 1. Universal Creative Graph

`packages/core/src/graph.js` defines the common structural layer.

Current node kinds include project, asset, composition, track, clip, layer, effect, output, and `object`. Current edge types include containment/reference/render relationships plus `relates-to` for semantic relationships.

The graph remains intentionally generic. A video clip, generated image, semantic person, timeline composition, delivery output, and effect all share one operation/history/collaboration boundary rather than introducing a new store for each feature family.

## 2. Creative Objects

`packages/core/src/creative-object.js` makes semantic entities first-class graph nodes.

A Creative Object can carry:

- object type and stable semantic identity;
- confidence and tags;
- semantic attributes;
- provenance and generation history;
- permissions;
- arbitrary JSON-safe attributes.

`relates-to` edges connect Creative Objects to assets, clips, layers, other objects, or other graph nodes. Relationship metadata can carry role, geometry, time, masks, tracking, transformations, and bounded metadata.

This lets concepts such as a person, product, wardrobe item, or location exist once while having many representations throughout a project.

Project invariants require Creative Objects to be rooted under the project/object hierarchy and semantic relationships to originate from Creative Objects with an explicit role.

## 3. Semantic Engine foundation

`packages/core/src/semantic-search.js` provides a deterministic, inspectable search baseline over graph names, object semantics, tags, selected media metadata, and relationship context.

The current search layer is deliberately lexical and deterministic. Future embeddings should be an additional scorer/retriever, not a replacement for inspectable graph identity or deterministic fallback behavior.

`createPlannerSemanticContext` in `packages/core/src/providers.js` uses that search layer to build a small relevant subgraph with a hard node ceiling and bounded neighbor expansion.

## 4. Model privacy boundary

Creative Objects support `permissions.modelAccess`:

- `full` — semantic object fields may enter model context;
- `metadata` — identity/type/tags are visible, while semantics, provenance, generation history, and attributes are redacted;
- `none` — the object and edges touching it are excluded from model snapshots.

Unknown policies fail closed.

All planner snapshots strip heavyweight/local asset fields such as asset URIs and waveforms. Focused semantic retrieval searches the already-redacted snapshot so private values cannot become retrieval side channels.

The same snapshot boundary is reused by routed media generation for source context.

## 5. Model Router

`packages/core/src/model-router.js` is provider-neutral. The graph does not contain vendor-specific model semantics.

Backends declare supported operations such as planning, embedding, image/video/audio generation or editing, transcription, and speech synthesis.

Routing policy can constrain:

- local versus remote execution;
- trusted remote access;
- maximum cost tier;
- explicit backend allow/deny lists;
- local preference.

An explicit `supported: false` result may fall through to another backend. A real backend failure does not silently fall through because ambiguous failure can mean work was partially performed or billed.

## 6. Agent lifecycle

The Agent is an operation planner, not an alternate editor.

The current lifecycle is:

1. provider receives privacy-filtered project context;
2. provider returns bounded summary + graph operations;
3. `createAgentPlan` preflights the complete operation batch and binds it to a semantic graph fingerprint;
4. `createAgentPlanReview` exposes bounded, human-readable operation impact;
5. a human may keep only selected operations, producing a new plan revision that is preflighted again;
6. unrelated intervening edits can be rebased only when existing operation-conflict analysis proves the proposal safe;
7. approval creates an ordinary graph transaction with Agent provenance;
8. normal history/journal/collaboration machinery persists that transaction.

The plan therefore follows:

`intent -> proposal -> review/revision -> validated transaction -> graph`

There is no separate persistent AI document model.

## 7. Generated media

`packages/core/src/generated-media.js` and `generation-runner.js` connect model output back into the common asset graph.

Generated media becomes an ordinary asset node with a bounded `media.generation-record.v1` record. `derives-from` edges connect it to source/reference nodes. A generated representation of a Creative Object uses a semantic relationship and appends an entry to that object's generation history.

Model binary payloads remain ephemeral to the graph. Only artifact descriptors and validated provenance become durable graph state. Storage/runtime layers are responsible for persisting the actual bytes and resolving them by asset identity.

## 8. Collaboration and history interaction

Agent plans, Creative Object edits, and generated-asset materialization all resolve to the same existing node/edge operation vocabulary. This is intentional:

- undo/redo does not need an AI-specific implementation;
- collaboration conflict analysis can inspect Agent edits;
- signed operation logs can carry Agent provenance;
- generated objects/assets remain serializable project state;
- delivery/render systems continue to consume standard assets and graph relationships.

## 9. Studio integration status

`apps/studio/agent-proposal-session.js` now owns a tested proposal lifecycle for Studio: propose, review, select operations, apply, discard, stale detection, and retry after persistence failure.

The existing legacy Agent path inside `apps/studio/app.js` still performs immediate planning/application. It should be migrated to the proposal session only when the full Studio test/build runner is available locally. The core/session contracts are intentionally landed first so the UI migration can remain thin.

## 10. Near-term implementation sequence

The highest-leverage next steps are:

1. wire Studio Agent rendering to `AgentProposalSession` with explicit Apply/Discard and operation selection;
2. persist generated model payloads through the existing asset-storage transaction while graph operations and bytes commit atomically;
3. add semantic enrichment producers (transcription, segmentation, tracking, embeddings) that write Creative Objects/relationships through normal operations;
4. add embeddings as a bounded optional semantic-search scorer while preserving deterministic fallback;
5. expose Creative Object inspection/search in Canvas and Cut;
6. use the same object/semantic context for generation/edit requests and project-level propagation workflows;
7. add focused conformance/performance fixtures for large semantic graphs and large Agent proposals.

The architectural constraint should remain stronger than any individual feature: new creative capabilities should compose through the graph rather than introducing disconnected application state.
