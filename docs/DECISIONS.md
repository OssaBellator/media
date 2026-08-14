# Early engineering decisions

## ADR-001: Graph-first project model

**Decision:** project state is a graph of creative objects and relationships.

**Reason:** cross-media editing depends on stable identities and relationships that survive switching views. A tree of application-specific documents would recreate suite boundaries inside a single executable.

## ADR-002: Agent output is operations

**Decision:** planners emit project operations rather than directly writing application state.

**Reason:** operations can be validated, previewed, audited, undone, priced and eventually collaborated on. This keeps model providers replaceable.

## ADR-003: Zero-dependency alpha shell

**Decision:** the first browser shell uses native modules and browser APIs.

**Reason:** the current architectural uncertainty is in the project/evaluation model, not component rendering. Avoiding a framework commitment makes the shell replaceable and enables local validation without network package installation.

## ADR-004: No GitHub Actions

**Decision:** repository quality gates are local scripts exposed through `npm run check`.

**Reason:** CI is explicitly unavailable for this repository. The scripts are portable so another CI system can call the same gate later without changing project semantics.
