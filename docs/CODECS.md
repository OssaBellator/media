# Codec and protected-media backends

`CodecBackendRegistry` separates container/kernel semantics from codec implementations.

Supported operations are `decode-video`, `decode-audio`, `encode-video` and `encode-audio`.

The browser router registers WebCodecs and can discover injected native/WASM backend objects. Priorities are configurable. A backend may probe an operation before execution.

## Plugin ABI

0.12 adds a small external-module ABI:

```js
export const manifest = {
  id: 'my-codec',
  apiVersion: 'media.codec.v1',
  operations: ['decode-video'],
  priority: 120,
};
```

A module may export operation functions directly or `createBackend(context)`. The returned object uses the same codec operation contract as built-in backends.

Browser plugin loading is explicit. Same-origin/blob modules are allowed by policy; other origins require an explicit trusted specification or allowlist. Media does not discover or execute arbitrary remote codec modules automatically.

`createProductionKernelRuntimeWithPlugins()` is the async production entry point when plugin modules must be loaded before codec tasks begin.

## Failure and health policy

Automatic fallback is conservative: only `CodecUnsupportedError` / `ERR_CODEC_UNSUPPORTED` proceeds to another backend by default. A corrupt stream or real decoder failure is surfaced. `CodecBackendHealth` records successes, unsupported results, failures and duration; repeated hard failures can temporarily quarantine a backend before later cooldown recovery.

## Protected samples

ISO Common Encryption metadata is inspected by the container layer. Cut and offline range audio raise typed `ERR_ENCRYPTED_MEDIA` before codec submission unless a caller injects a `decryptSample` implementation. That callback receives only the selected encoded sample plus scheme/KID/IV/pattern/subsample metadata and must return clear bytes.

Media does **not** provide DRM license acquisition, CDM/key-system policy, key storage or AES decryption algorithms. Those remain authorized host/backend responsibilities.

No native or WASM codec binaries are bundled by this repository.
