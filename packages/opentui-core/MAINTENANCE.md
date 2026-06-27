# Vendored OpenTUI Maintenance

This workspace owns the `@ax-code/opentui-*` packages used by the shipping
TUI:

- `@ax-code/opentui-core`
- `@ax-code/opentui-solid`
- `@ax-code/opentui-spinner`

These packages are vendored forks, not direct upstream dependencies. The
application should import the `@ax-code/opentui-*` packages only.

## Ownership Boundary

`@ax-code/opentui-core` contains the vendored JavaScript, type declarations,
runtime-plugin glue, tree-sitter assets, and ax-code-specific renderer fixes.
It does not vendor the compiled Zig native libraries. Those still come from the
upstream `@opentui/core-<platform>` optional dependency packages and are pinned
in `packages/opentui-core/package.json`.

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

## Update Workflow

When syncing from upstream OpenTUI:

1. Update the vendored package contents in `packages/opentui-core` and
   `packages/opentui-solid`.
2. Keep the `@ax-code/opentui-*` package names and exports stable unless the
   TUI build scripts are updated in the same change.
3. Update the upstream native `@opentui/core-<platform>` optional dependency
   versions in `packages/opentui-core/package.json` if the core ABI changes.
4. Re-apply ax-code-specific fixes, especially the FFI geometry guard.
5. Verify source, bundled, and startup paths before merging.

Minimum verification for an OpenTUI sync or local renderer fix:

```sh
pnpm --dir packages/ax-code run check:tui-layering
pnpm --dir packages/ax-code run check:tui-snapshot
pnpm --dir packages/ax-code exec vitest run test/cli/tui/opentui-ffi-coordinate-guard.test.ts test/cli/tui/opentui-spinner.test.ts test/script/tui-startup-smoke.test.ts test/script/check-tui-layering.test.ts
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
