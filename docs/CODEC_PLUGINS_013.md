# Integrity-pinned and signed codec plugins

0.13 added a production loading path for `media.codec.v1` plugin bundles. 0.16 restores that verified-byte path as the default for remote Studio codec plugins and adds optional signature policy plus deterministic packaging metadata.

A remote production spec declares a URL plus SHA-256 integrity. Both `sha256-<base64>` SRI and 64-character hexadecimal SHA-256 are accepted. The loader checks the requested origin, fetches bytes, rechecks the final redirect origin, verifies the digest, verifies the signature policy when configured, and only then imports those exact verified bytes. `trusted: true` no longer bypasses remote integrity; embedded/native backends use the explicit `module` spec path instead.

Plugin manifests may declare `minHostVersion` and `maxHostVersion`. `createSecureProductionKernelRuntime()` injects the Media runtime version and requires integrity by default.

Signatures are optional unless `requireSignature` is enabled. A verifier receives the exact plugin bytes plus a canonical `media.codec.package.v1` statement containing the normalized integrity pin, plugin id/version/API version, and host-version bounds. The repository does not prescribe a PKI or key-distribution system; callers inject `verifySignature` and signer metadata according to their deployment trust model.

`scripts/package-codec-plugin.mjs` generates the loader-compatible SRI pin, legacy hex digest, descriptor, and canonical signature statement from an exact self-contained ESM bundle. Browser plugin bundles should remain self-contained: relative dependency graphs are outside the single-file verified byte envelope.
