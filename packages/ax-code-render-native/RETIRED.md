# RETIRED — `@ax-code/render`

This package was the ADR-046 OpenTUI N-API render overlay (Zig replacement under
Solid/OpenTUI), including the Yoga scope scaffold.

**Status:** retired. Do not build, ship, or re-enable as a product path.

AX Code now has two UI engines only:

| Engine | Path |
|--------|------|
| `zig` (default) | Node + Solid + OpenTUI with the bundled Zig library |
| `native` (experimental) | `crates/ax-code-tui` Rust/Ratatui sidecar over an authenticated loopback runtime |

Use:

```sh
AX_CODE_TUI_ENGINE=native ax-code
# or
script/dogfood-native-tui.sh
```

Legacy `AX_CODE_NATIVE_RENDER*` environment variables are forced off and ignored.
