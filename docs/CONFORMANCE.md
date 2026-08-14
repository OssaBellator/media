# Conformance and performance budgets

0.9 introduces small deterministic checks that can run in Node without browser media implementations.

## Structural checks

- encoded chunk byte ranges stay within source size;
- per-track decode timestamps/sequences are monotonic;
- render chunks are contiguous, ordered and sum to the manifest frame count.

## Runtime counters

Cut and range sources expose enough counters to derive:

- source bytes read;
- encoded bytes consumed;
- source-read amplification;
- decoded frame requests/cache hits;
- stale presented-frame ratio;
- dropped-frame ratio where callers report drops.

## Budgets

`conformanceBudget()` evaluates metrics against explicit limits. Defaults are intentionally conservative reference values rather than product SLAs. Real camera/browser fixture runs should provide workload-specific budgets.

The goal is to make performance regressions observable in the same local test discipline as mux/demux correctness, without requiring GitHub Actions.
