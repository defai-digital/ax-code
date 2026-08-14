# AX Code OpenTUI patches

These are the required local fixes applied on top of the vendored OpenTUI JS.
They are reviewable documents plus an idempotent applier:

```sh
pnpm apply:opentui-patches   # no-op when already applied
pnpm check:opentui-patches   # fail if a sync dropped a fix
```

Do not re-implement these by hand-editing hashed `index-*.js` chunks during a
sync. Drop in the upstream JS, then run the applier.

| Id                         | File                                                         | What it protects                                         |
| -------------------------- | ------------------------------------------------------------ | -------------------------------------------------------- |
| `ffi-pointer-pin`          | [ffi-pointer-pin.md](./ffi-pointer-pin.md)                   | V8 GC use-after-free under `node:ffi`                    |
| `ffi-geometry-guard`       | [ffi-geometry-guard.md](./ffi-geometry-guard.md)             | `u32` crash on off-screen draw geometry                  |
| `vendored-native-resolver` | [vendored-native-resolver.md](./vendored-native-resolver.md) | Load `vendor/<target>/` instead of npm platform packages |
| `drop-zig-parser`          | [drop-zig-parser.md](./drop-zig-parser.md)                   | Stop shipping / loading the unused Zig highlight grammar |
