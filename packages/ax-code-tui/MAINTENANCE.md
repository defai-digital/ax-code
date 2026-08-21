# AX Code TUI maintenance

`@ax-code/tui` is the single AX-owned terminal UI package. Its supported product surface is:

- `@ax-code/tui` for the native renderer and renderables;
- `@ax-code/tui/solid` for the SolidJS reconciler and JSX runtime;
- `@ax-code/tui/spinner` and `@ax-code/tui/spinner/solid` for the AX spinner.

Application code must use these exports only. The package is private to the workspace and is copied as one unit into
the bundled CLI.

## Ownership boundary

AX Code owns package identity, exports, integration, release staging, regression policy, and local fixes. The current
renderer snapshot and native libraries retain their upstream MIT lineage; see [UPSTREAM.md](./UPSTREAM.md),
[DIVERGENCES.md](./DIVERGENCES.md), [LICENSE](./LICENSE), and [`vendor/manifest.json`](./vendor/manifest.json).

The root contains the renderer JavaScript, declarations, runtime-plugin glue, tree-sitter assets, and native libraries.
`solid/` contains the reconciler, JSX runtimes, preload shims, and the supported `./solid/transform` build API.
`spinner/` contains TypeScript source plus committed `dist/` output. These are subpaths of one package, not independent
workspace packages.

The native resolver maps `(platform, arch, AX_CODE_TUI_LIBC)` to `vendor/<target>/` relative to the package root.
Upstream platform package names and `libopentui`/`opentui.dll` filenames remain only as ABI and provenance identifiers.

## Required AX divergences

Named, idempotent patch contracts live under `patches/` and `solid/patches/`. They preserve:

- Node FFI pointer liveness;
- safe native draw geometry;
- a working Kitty keyboard protocol opt-out;
- deterministic, offline native resolution;
- omission of the unused Zig parser;
- the reduced Solid intrinsic catalogue; and
- removal of upstream-only test remnants; and
- AX-owned runtime flags and plugin/worker identities.

Do not hand-edit new hashed renderer chunks after an upstream refresh. Apply and verify the contracts:

```sh
pnpm apply:tui-patches
pnpm check:tui-patches
```

The current renderer is a pre-bundled JavaScript snapshot. Converting it to owned, narrow source modules is a separate
compatibility phase: preserve `import.meta.url` resolution for native and tree-sitter assets, and prove native/JS ABI
compatibility before changing the source baseline.

## Upstream refresh

1. Pin one exact upstream source/package/native version.
2. Refresh renderer and Solid artifacts together under `packages/ax-code-tui/`.
3. If the native ABI changed, update `VERSION` in `script/vendor-tui-native.ts` and run `pnpm vendor:tui-native`.
4. Run `pnpm apply:tui-patches`; review every ledger entry instead of overwriting AX fixes.
5. Rebuild the spinner output with `pnpm --dir packages/ax-code-tui run build`.
6. Run all verification below and update provenance, hashes, and divergences in the same change.

## Verification

```sh
pnpm run check:tui-vendor
pnpm run check:tui-patches
pnpm run check:tui-spinner-dist
pnpm --dir packages/ax-code run test:tui-renderer
pnpm --dir packages/ax-code run check:tui-layering
pnpm --dir packages/ax-code run check:tui-snapshot
pnpm --dir packages/ax-code run tui:startup-smoke
pnpm --dir packages/ax-code run tui:startup-smoke -- --terminal-profile advanced
```

Also run `pnpm --dir packages/ax-code run build -- --single` when exports, runtime loading, native resolution, or release
packaging changes.

## Runtime invariants

The compatible terminal profile is the default. The advanced profile is opt-in through
`AX_CODE_TUI_ADVANCED_TERMINAL=1` and enables alternate-screen plus the render thread. Kitty keyboard negotiation is
enabled in both profiles unless `AX_CODE_TUI_KITTY_KEYBOARD=0` explicitly disables it.

Terminal teardown is ordered and best-effort: title cleanup, renderer destruction, mouse reset, main-screen clearing,
and output flushing are separate failure domains. Deferred work, timers, subscriptions, process handlers, and renderable
access must use the named TUI lifecycle and safety helpers so route changes and shutdown cannot leave stale work behind.
