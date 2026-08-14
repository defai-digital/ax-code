# Vendored OpenTUI Maintenance

This workspace owns the `@ax-code/opentui-*` packages used by the shipping
TUI:

- `@ax-code/opentui-core`
- `@ax-code/opentui-solid`
- `@ax-code/opentui-spinner`

These packages are vendored forks, not direct upstream dependencies. The
application should import the `@ax-code/opentui-*` packages only.

Required JS fixes live as named, idempotent patches under
`packages/opentui-core/patches/` (and the Solid catalogue slim under
`packages/opentui-solid/patches/`). After dropping in upstream JS:

```sh
pnpm apply:opentui-patches
pnpm check:opentui-patches
```

Do not re-discover the insertion points by hand-editing hashed `index-*.js`
chunks. The shipping Node TUI copies these packages through
`shouldCopyOpentuiDistPath()` so tests, type-only files, unused Zig highlight
assets, and patch docs stay out of the archive.

The core is still a pre-bundled JS dump. Unused renderable *classes* therefore
remain in the hashed chunks; the Solid catalogue is the TUI-facing allowlist
and must not register `ascii_font`, `tab_select`, or the stock `select`
widget. Vendoring OpenTUI TypeScript source and bundling a narrow entry into
the TUI is a separate follow-up — it cannot be done by tree-shaking these
chunks, and bundling them today would break `import.meta.url` resolution for
the native library and tree-sitter assets.

## Ownership Boundary

`@ax-code/opentui-core` contains the vendored JavaScript, type declarations,
runtime-plugin glue, tree-sitter assets, and ax-code-specific renderer fixes.
It also vendors the compiled Zig native libraries: they live in-repo under
`packages/opentui-core/vendor/<target>/` (one directory per upstream target),
fetched from the upstream `@opentui/core-<platform>` npm packages and
hash-pinned by `vendor/manifest.json`. The runtime resolver loads the library
relative to the package root, so nothing is resolved through `node_modules`
at runtime. Re-fetch or upgrade with `pnpm vendor:opentui-native`; verify the
committed tree offline with `pnpm check:opentui-vendor`.

`@ax-code/opentui-solid` contains the vendored SolidJS renderer and the Node/Bun
preload and plugin support used by source and bundled TUI builds.
Its `./transform` export is the supported API for build-time Solid JSX
transforms; build scripts should not resolve internal files next to
`./bun-plugin`.

`@ax-code/opentui-spinner` contains the spinner renderable used by the TUI. It
is maintained with the other vendored OpenTUI packages because it depends on the
core and Solid renderer contracts.

## Required Local Fixes

The vendored core must preserve ax-code's FFI geometry guard. Node's
`--experimental-ffi` marshalling rejects negative, fractional, or non-finite
`u32` coordinates. The guard drops or clips invalid draw geometry before it
reaches native OpenTUI symbols, preventing render-loop crashes when content is
partially off-screen.

The regression test for this guard is:

```sh
pnpm --dir packages/ax-code exec vitest run test/cli/tui/opentui-ffi-coordinate-guard.test.ts
```

The vendored core must also preserve the FFI pointer pin. Under Node's
`--experimental-ffi`, `getRawPointer()` returns a bare address with no
liveness tie, and V8's precise GC (unlike Bun's conservative JSC scan) may
free a packed struct buffer — and the encoded chunk text it anchors through
`retainPointerTarget` — before the native call dereferences it. That
use-after-free segfaulted the CLI inside Zig's
`text-buffer.UnifiedTextBuffer.setStyledText` during long streaming sessions.
Every pointer source handed to `nodeFfi.getRawPointer()` must first be pinned
via `pinNodePointerSource()` (a fixed-size strong ring) so it stays reachable
until the synchronous native call returns.

The regression test for the pin is:

```sh
pnpm --dir packages/ax-code exec vitest run test/cli/tui/opentui-ffi-pointer-pin.test.ts
```

The vendored core must also preserve the vendored native resolver. Upstream
resolves the Zig shared library by dynamically importing the
`@opentui/core-<platform>` npm packages; ax-code instead maps
`(platform, arch, OPENTUI_LIBC)` to a target key and loads
`vendor/<target>/libopentui.{dylib,so,dll}` relative to the package root, with
an actionable error (target, absolute path, `pnpm vendor:opentui-native`
remedy) when the file is missing. The eager dlopen at module load remains
non-fatal so headless commands keep working; the raised initialization error
carries the target, path, and original `cause`.

The regression test for the resolver is:

```sh
pnpm --dir packages/ax-code exec vitest run test/cli/tui/opentui-vendored-native-resolver.test.ts
```

OpenTUI has one renderer path: the upstream Zig native library. The ADR-046
`@ax-code/render` N-API overlay and its `yoga` routing scope are retired, and
the experimental standalone Rust/Ratatui UI (`crates/ax-code-tui`) was removed
in 2026-07 — Zig/OpenTUI is the only UI engine. The layout engine used
internally by OpenTUI is still Yoga, but it is an implementation detail rather
than a selectable AX Code mode. Legacy `AX_CODE_NATIVE_RENDER*` values are
forced off and ignored.

The OpenTUI golden-frame gate validates only the Zig application path:

```sh
pnpm --dir packages/ax-code run check:golden-frames
```

## Update Workflow

When syncing from upstream OpenTUI:

1. Update the vendored package contents in `packages/opentui-core` and
   `packages/opentui-solid`.
2. Keep the `@ax-code/opentui-*` package names and exports stable unless the
   TUI build scripts are updated in the same change.
3. Update the vendored native libraries if the core ABI changes: bump
   `VERSION` in `script/vendor-opentui.ts`, run `pnpm vendor:opentui-native`,
   and commit the refreshed `vendor/` tree and manifest.
4. Re-apply ax-code-specific fixes with `pnpm apply:opentui-patches` (FFI
   geometry guard, FFI pointer pin, vendored native resolver, drop Zig parser,
   slim Solid catalogue). Do not hand-edit hashed chunks.
5. Verify source, bundled, and startup paths before merging.

Minimum verification for an OpenTUI sync or local renderer fix:

```sh
pnpm run check:opentui-vendor
pnpm run check:opentui-patches
pnpm --dir packages/ax-code run check:tui-layering
pnpm --dir packages/ax-code run check:tui-snapshot
pnpm --dir packages/ax-code exec vitest run test/cli/tui/opentui-ffi-coordinate-guard.test.ts test/cli/tui/opentui-ffi-pointer-pin.test.ts test/cli/tui/opentui-vendored-native-resolver.test.ts test/cli/tui/opentui-spinner.test.ts test/script/tui-startup-smoke.test.ts test/script/check-tui-layering.test.ts
pnpm --dir packages/ax-code run tui:startup-smoke
pnpm --dir packages/ax-code run tui:startup-smoke -- --terminal-profile advanced
```

Run `pnpm --dir packages/ax-code run build -- --single` as well when the change
affects package exports, runtime-plugin loading, native dependency resolution,
or distribution packaging.

The compatible renderer profile is the production default. The advanced profile
is opt-in (`AX_CODE_TUI_ADVANCED_TERMINAL=1`) and enables alternate-screen,
Kitty keyboard negotiation, and OpenTUI's render thread. Any change that touches
renderer options, terminal cleanup, startup diagnostics, or native OpenTUI
integration must keep both startup-smoke profiles passing.

Terminal teardown must remain best-effort and ordered. Title cleanup,
`renderer.destroy()`, mouse-tracking reset, main-screen clearing, and stdout
flush are separate failure domains; a failure in one step must not prevent later
terminal recovery steps from running. If `renderer.destroy()` fails, cleanup
must still run before the original destroy error is rethrown.

Deferred startup work in the TUI must use `scheduleDeferredStartupTask()` with a
stable task name. Microtask handoffs and other fire-and-forget UI work must use
the shared TUI background-task boundary instead of ad hoc `void promise.catch`
patterns. Solid/OpenTUI component timers that touch renderables or reactive
state must use the named TUI timer helpers instead of raw `setTimeout` or
`setInterval`, so they are cancellable on cleanup, can opt out of keeping the
process alive, and run callbacks through the same background failure boundary.
Event listeners, abort forwarding, external event subscriptions, and process
handlers must use named lifecycle helpers so reconnects, route switches, worker
restarts, and teardown paths unregister exactly once. OpenTUI renderable access
that focuses, blurs, or walks children must use named renderable-safety helpers
so stale or destroyed renderables degrade without throwing during route changes
or dialog handoffs. Optional startup state, delayed hydration, focus
restoration, layout refresh, polling, countdown, subscription cleanup,
renderable lookup, and reconnect recovery work are allowed to fail, but
failures must stay inside that named boundary: callers may handle expected
degradation locally, and otherwise the helper logs the named failure instead of
creating an unhandled rejection or crashing the TUI.
