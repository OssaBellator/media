# Codec backends

`CodecBackendRegistry` separates container/kernel semantics from codec implementations.

Supported operation names:

- `decode-video`
- `decode-audio`
- `encode-video`
- `encode-audio`

The browser router registers WebCodecs and can discover injected `MediaNativeCodecBackend` and `MediaWasmCodecBackend` objects. Priorities are configurable. A backend may probe an operation before execution.

Automatic fallback is conservative: only `CodecUnsupportedError` / `ERR_CODEC_UNSUPPORTED` proceeds to another backend. A corrupt stream or real decoder failure is surfaced rather than hidden by trying a different implementation unless a caller explicitly enables fallback-on-error.

No native or WASM codec binaries are bundled by this repository.
