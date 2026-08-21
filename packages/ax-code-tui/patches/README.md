# AX Code TUI patch contracts

These are the required AX-owned fixes applied to the pinned renderer snapshot.
They are reviewable documents plus an idempotent applier:

```sh
pnpm apply:tui-patches   # no-op when already applied
pnpm check:tui-patches   # fail if a sync dropped a fix
```

Do not re-implement these by hand-editing hashed `index-*.js` chunks during a
sync. Drop in the upstream JS, then run the applier.

| Id                         | File                                                         | What it protects                                         |
| -------------------------- | ------------------------------------------------------------ | -------------------------------------------------------- |
| `ffi-pointer-pin`          | [ffi-pointer-pin.md](./ffi-pointer-pin.md)                   | V8 GC use-after-free under `node:ffi`                    |
| `ffi-geometry-guard`       | [ffi-geometry-guard.md](./ffi-geometry-guard.md)             | `u32` crash on off-screen draw geometry                  |
| `vendored-native-resolver` | [vendored-native-resolver.md](./vendored-native-resolver.md) | Load `vendor/<target>/` instead of npm platform packages |
| `kitty-keyboard-opt-out`   | [kitty-keyboard-opt-out.md](./kitty-keyboard-opt-out.md)     | Preserve the documented `null` protocol opt-out          |
| `drop-zig-parser`          | [drop-zig-parser.md](./drop-zig-parser.md)                   | Stop shipping / loading the unused Zig highlight grammar |
