# RETIRED — `@ax-code/render`

This package was the ADR-046 OpenTUI N-API render overlay (Zig replacement under
Solid/OpenTUI), including the Yoga scope scaffold.

**Status:** retired. Do not build, ship, or re-enable as a product path.

AX Code has a single UI engine:

| Engine | Path |
|--------|------|
| `zig` | Node + Solid + OpenTUI with the bundled Zig library |

The `native` successor (`crates/ax-code-tui` Rust/Ratatui sidecar, launched via
`AX_CODE_TUI_ENGINE=native`) was removed in 2026-07.

Legacy `AX_CODE_NATIVE_RENDER*` environment variables are forced off and ignored.
