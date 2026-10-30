# Native test suite

This directory contains tests for AX TUI's Zig components.

From the repository root:

```sh
pnpm run test:native
```

The wrapper selects the compiler pinned in `.zig-version` and supports
`AX_CODE_TUI_ZIG` and `AX_CODE_TUI_MACOS_SDK`; see `MAINTENANCE.md`.
Quality runs this suite on every push. `abi-layout_test.zig` checks the
committed FFI layout against the native extern structs.

To add a suite, create `tests/<name>_test.zig`, import it in `../test.zig`
using `@import("tests/<name>_test.zig")`, and reference the imported module
in that file's test block. Add dependencies in `../build.zig` if needed.
