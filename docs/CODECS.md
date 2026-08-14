# Codec and protected-media backends

`CodecBackendRegistry` separates container/kernel semantics from codec implementations.

Supported operation names:

- `decode-video`
- `decode-audio`
- `encode-video`
- `encode-audio`

The browser router registers WebCodecs and can discover injected native and WASM backend objects. Priorities are configurable. A backend may probe an operation before execution.

## Failure and health policy

Automatic fallback is conservative: only `CodecUnsupportedError` / `ERR_CODEC_UNSUPPORTED` proceeds to another backend by default. A corrupt stream or real decoder failure is surfaced. `CodecBackendHealth` records successes, unsupported results, failures and duration; repeated hard failures can temporarily quarantine a backend before later cooldown recovery.

## Protected samples

ISO Common Encryption metadata is inspected by the container layer. Cut and offline range audio raise typed `ERR_ENCRYPTED_MEDIA` before codec submission unless a caller injects a `decryptSample` implementation. That callback receives only the selected encoded sample plus scheme/KID/IV/pattern/subsample metadata and must return clear bytes.

Media does **not** provide DRM license acquisition, CDM/key-system policy, key storage or AES decryption algorithms. Those remain authorized host/backend responsibilities.

No native or WASM codec binaries are bundled by this repository.
