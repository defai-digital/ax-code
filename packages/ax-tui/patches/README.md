# AX TUI behavior contracts

These documents describe inherited AX fixes now maintained in TypeScript.
Edit `src/`, `solid/source/`, or `native/source/`, then regenerate artifacts:

```sh
pnpm run build:renderer
pnpm run check:patches
```

`script/tui-patches.ts` verifies source contracts. It does not rewrite bundles.
Do not hand-edit hashed `index-*.js` files or replace them with upstream output.
See `DIVERGENCES.md` for the full ledger and regression coverage.

| Contract                   | Protects                                                 |
| -------------------------- | -------------------------------------------------------- |
| `ffi-pointer-pin`          | Pointer owner liveness across synchronous Node FFI calls |
| `ffi-geometry-guard`       | Safe integer geometry at native draw boundaries          |
| `vendored-native-resolver` | Bundled native resolution with verified cache fallback   |
| `kitty-keyboard-opt-out`   | Explicit null disables Kitty protocol                    |
| `stdin-parser-timeout`     | Split terminal replies remain buffered for 100ms         |
| `drop-zig-parser`          | The unused Zig highlight grammar is not loaded           |
| `slim-catalogue`           | Supported Solid intrinsic registrations remain bounded   |
