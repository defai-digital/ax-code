# `ffi-pointer-pin`

Node's `--experimental-ffi` `getRawPointer()` returns a bare address with no
liveness tie. V8's precise GC (unlike Bun's conservative JSC scan) can free
the packed struct buffer — and the encoded chunk text it anchors — before
Zig dereferences it. Observed crash: SIGSEGV in
`text-buffer.UnifiedTextBuffer.setStyledText` during long streaming sessions.

## Contract

1. A fixed-size strong ring (`NODE_POINTER_PIN_SLOTS`, `pinNodePointerSource`)
   exists in the FFI render module.
2. Every `nodeFfi.getRawPointer(` call site pins its source in the same branch,
   immediately before taking the address.

Regression: `packages/ax-code/test/cli/tui/opentui-ffi-pointer-pin.test.ts`.
