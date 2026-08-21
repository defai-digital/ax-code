# AX Code TUI divergence ledger

Every behavior change from the pinned renderer snapshot must have an observable rationale and a regression guard.

| ID                         | Scope                    | AX behavior                                                                                                                                                                                | Regression guard                          |
| -------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| `ffi-pointer-pin`          | Node FFI                 | Pointer source owners stay strongly reachable until synchronous native consumers return.                                                                                                   | `tui-ffi-pointer-pin.test.ts`             |
| `ffi-geometry-guard`       | Native draw boundary     | Negative, fractional, non-finite, and empty geometry is sanitized before strict Node FFI marshaling.                                                                                       | `tui-ffi-coordinate-guard.test.ts`        |
| `vendored-native-resolver` | Offline packaging        | Runtime selects a hash-pinned native library relative to `@ax-code/tui`, with `AX_CODE_TUI_LIBC` for Linux override.                                                                       | `tui-vendored-native-resolver.test.ts`    |
| `kitty-keyboard-opt-out`   | Terminal input           | An explicit `useKittyKeyboard: null` disables Kitty protocol enablement and parsing instead of being replaced by the default configuration.                                                | `check:tui-patches` and patch tests       |
| `drop-zig-parser`          | Tree-sitter assets       | The unused Zig parser and registration are omitted from the shipped package.                                                                                                               | `check:tui-patches`                       |
| `slim-solid-catalogue`     | Solid reconciler         | Unused ASCII font, select, and tab-select intrinsic registrations are omitted.                                                                                                             | `check:tui-patches` and TUI surface tests |
| `drop-test-remnants`       | Package contents         | Upstream-only test/reproduction artifacts are not shipped.                                                                                                                                 | `check:tui-patches`                       |
| `ax-runtime-identity`      | JS runtime configuration | AX-owned flags, virtual module IDs, worker globals, and Solid plugin keys use AX Code TUI names. Native ABI filenames, symbols, and capability keys retain their pinned upstream spelling. | `check:tui-patches` and patch tests       |

## Sync rule

Do not overwrite the package wholesale during an upstream refresh. Re-verify every row after applying the new snapshot.
Removing a divergence requires evidence that the pinned upstream version now provides equivalent behavior and that the
corresponding regression guard still passes.
