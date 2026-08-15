# Integrity-pinned codec plugins

0.13 adds a production loading path for `media.codec.v1` plugin bundles.

A production spec should declare an HTTPS/same-origin URL plus SHA-256 integrity. Both `sha256-<base64>` SRI and 64-character hexadecimal SHA-256 are accepted. The loader fetches bytes, verifies the digest, rechecks the final redirect origin, then imports those verified bytes.

Plugin manifests may declare `minHostVersion` and `maxHostVersion`. `createSecureProductionKernelRuntime()` injects Media 0.13.0 as the host version and requires integrity by default.

This is integrity pinning, not a general-purpose code-signing PKI. Browser plugin bundles should currently be self-contained ESM files; relative dependency graphs are outside the verified byte envelope.
