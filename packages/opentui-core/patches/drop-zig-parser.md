# `drop-zig-parser`

Upstream `addDefaultParsers` eagerly resolves the Zig tree-sitter wasm (~680K)
even though the AX Code TUI never highlights Zig. The files are removed from
`assets/zig/` and `loadParsers()` must not reference them, or the first
highlight call throws.

## Contract

1. `packages/opentui-core/assets/zig/` does not exist.
2. The FFI/default-parser module does not call `resolveBundledFilePath` for
   `./assets/zig/`.
3. The default parser list has no `filetype: "zig"` entry.
