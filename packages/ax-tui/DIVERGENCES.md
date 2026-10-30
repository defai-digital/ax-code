# AX TUI behavior ledger

Inherited AX fixes now live in the owned TypeScript sources. Behavior changes must have an observable rationale and a regression guard.

| ID                         | Scope                    | AX behavior                                                                                                                                                                                                                 | Regression guard                          |
| -------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `ffi-pointer-pin`          | Node FFI                 | Pointer source owners stay strongly reachable until synchronous native consumers return.                                                                                                                                    | `tui-ffi-pointer-pin.test.ts`             |
| `ffi-geometry-guard`       | Native draw boundary     | Negative, fractional, non-finite, and empty geometry is sanitized before strict Node FFI marshaling.                                                                                                                        | `tui-ffi-coordinate-guard.test.ts`        |
| `vendored-native-resolver` | Offline packaging        | Runtime selects a hash-pinned native library relative to `ax-tui`, with `AX_CODE_TUI_LIBC` for Linux override.                                                                                                              | `tui-vendored-native-resolver.test.ts`    |
| `kitty-keyboard-opt-out`   | Terminal input           | An explicit `useKittyKeyboard: null` disables Kitty protocol enablement and parsing instead of being replaced by the default configuration.                                                                                 | `check:patches` and source contract tests |
| `stdin-parser-timeout`     | Terminal input           | The pending-escape-sequence assembly timeout is 100ms (configurable via `stdinParserTimeoutMs`), not 20ms, so a terminal reply split across two reads under load isn't abandoned mid-sequence and re-typed as literal text. | `check:patches` and source contract tests |
| `drop-zig-parser`          | Tree-sitter assets       | The unused Zig parser and registration are omitted from the shipped package.                                                                                                                                                | `check:patches`                           |
| `slim-solid-catalogue`     | Solid reconciler         | Unused ASCII font, select, and tab-select intrinsic registrations are omitted.                                                                                                                                              | `check:patches` and TUI surface tests     |
| `drop-test-remnants`       | Package contents         | Upstream-only test/reproduction artifacts are not shipped.                                                                                                                                                                  | `check:patches`                           |
| `ax-runtime-identity`      | JS runtime configuration | AX-owned flags, virtual module IDs, worker globals, and Solid plugin keys use AX Code TUI names. Native libraries, terminal overrides, notifications, and the Yoga FFI entry use AX TUI identities.                         | `check:patches` and source contract tests |

## Source ownership

These contracts are implemented in `src/`, `solid/source/`, and `native/source/`.

Native Windows stdout output additionally selects UTF-8 only for console handles.
A shared lease restores the original output code page after the last stdout
backend closes, while preserving subsequent external code-page changes. Memory,
feed, and redirected outputs leave the local console unchanged. Guards:
`native/renderer/tests/renderer_test.zig` and `test/terminal-quality.test.ts`.
`script/tui-patches.ts` checks them without rewriting generated bundles.
`test/core-ffi.test.ts` and `test/core-stdin-parser.test.ts` cover the imported
FFI adapter and terminal parser. `test/source-renderer.test.ts` exercises Solid
reactivity, cleanup, and bundled tree-sitter assets against the locally built
native backend. The historical AX Code regression names above identify their
original downstream guards; downstream applications retain their own suites.

`native-asset-delivery` delegates to `ax-tui/native`, preferring bundled assets
and otherwise using bounded downloads and a manifest-verified cache. Guards:
`test/native-delivery.test.ts`, `test/native-delivery-renderer.test.ts`, and
`script/stage-native-assets.test.ts`.

`source-native-build` replaces upstream package extraction with local Zig/C
compilation. `check:vendor` verifies source hashes as well as binary hashes,
licenses, and architecture; `script/build-native.test.ts` and
`script/vendor-tui-native.test.ts` guard the build metadata and target selection.

Chart coordinate normalization now handles finite bounds near the limits of
JavaScript numbers without overflowing or hanging rasterization. Invalid
raster endpoints fail closed. X/Y axis colors apply to their respective lines;
`test/chart-layout.test.ts` covers these behaviors.

`DataPathsManager` defaults to the `ax-tui` application namespace, so its
configuration and parser cache do not share OpenTUI defaults.
`test/data-paths.test.ts` verifies isolation and custom application paths.

External source changes must preserve these contracts or include an explicit
behavioral change and updated tests. Never replace generated bundles directly.

`independent-native-interface` gives the native backend AX library names and
an explicit ABI version probe, replaces inherited terminal environment and
notification identities, and preserves two public TypeScript forwarding aliases.
`script/check-independence.test.ts`, `test/native-abi.test.ts`, the native Yoga
and terminal suites, and the source renderer integration guard this boundary.

## Stability and boundary contracts

- `editor-view-lifetime`: independently disposed editor views use a reclaiming
  allocator instead of the process-lifetime arena. Overlapping non-LIFO teardown
  must not grow that arena. Guard: `test/editor-view-lifecycle.test.ts`; the mixed
  application soak also bounds arena growth after warmup.
- `atomic-buffer-resize`: native allocation failure preserves old storage and
  dimensions. ABI 2 returns a resize success flag; TypeScript throws on failure.
  Guards: `native/renderer/tests/buffer_test.zig`, `test/buffer-boundaries.test.ts`.
- `capture-graphemes`: captured rows retain right-edge wide characters, combining
  marks, emoji clusters, color intent, and independent color snapshots. Guards:
  `test/native-buffer-runtime.test.ts` and the native buffer suite.
- `client-lifecycle-isolation`: client cleanup cannot cancel another client's
  timers or resurrect removed buffers. Guards: `test/tree-sitter-lifecycle.test.ts`
  and `test/debounce.test.ts`.
- `complete-viewport-overlap`: scan all candidates before the viewport end;
  arbitrary overlapping sizes cannot be culled with a fixed look-behind limit.
  `test/layout-boundaries.test.ts` compares against a full rectangle oracle.
- `bounded-parser-download`: URL identity uses SHA-256, writes use atomic rename,
  and remote bodies have a 64 MiB / 30 second limit. Empty responses are errors.
  Guards: `test/parser-download.test.ts`; bundled parsing remains offline.

Cancelled debounce operations now reject with an `AbortError` instead of leaving
promises pending forever. Internal scheduled resets consume cancellation; direct
users of this helper must handle rejection. Invalid public buffer dimensions and
renderer frame rates throw `RangeError` before native allocation or scheduling.

- `native-image-control-order`: ABI 3 accepts whole control writes into an owned
  32 MiB FIFO, reserves space for small cleanup controls, and retains exact byte
  progress while a feed is saturated. Cell frames cannot overtake uploads, and
  external control writes cannot interrupt a partial Kitty APC. Guards: the native
  renderer suite and `test/image-renderable.test.ts`.
- `application-focus-ownership`: opt-in navigation follows live tree membership;
  OverlayManager remains responsible for restoration. Command execution rechecks
  registrations and captured context and returns errors as explicit results.
  Guard: `test/application-navigation.test.ts`.

- `split-footer-qualification`: captured stdout snapshots preserve display-cell
  widths, grapheme boundaries, tab stops, and CRLF content; failure releases
  provisional snapshots/nodes. Scrollback commits reject non-finite row columns
  and normalize flags. Failed surface paints invalidate the previous buffer,
  destruction cancels settlement waits, and destroyed renderers cannot recapture
  stdout. Capture-mode resize appends pending snapshots using the new geometry
  and does not scrub transcript rows above the footer. Guards:
  `test/renderer-scrollback-surface.test.ts`, `test/renderer-split-footer.test.ts`,
  and `test/pty-split-footer.test.ts`. See `UPSTREAM.md` for the exact test port,
  inline configuration, dropped newer APIs, and qualification limits.
