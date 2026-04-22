# ax-code v4.0.7

This release hardens the normal-mode first-submit path in the TUI for packaged installs, especially when the app would hang at `Creating session...` while the same flow worked under debug mode.

## Highlights

- Made normal-mode log files run-scoped and component-scoped so the main process and TUI worker no longer collide on the same default log basename.
- Updated log cleanup to recognize the new stamped naming scheme without mixing in `.json.log` files.
- Hardened worker RPC so handler failures return an explicit error envelope instead of leaving the caller stuck until a timeout.
- Added focused regression tests for log naming and RPC error propagation on the worker boundary.

## Verification

- `pnpm --dir packages/ax-code exec bun test test/util/log.test.ts test/util/rpc.test.ts`
- `pnpm --dir packages/ax-code exec tsc --noEmit --pretty false --incremental false --project tsconfig.json`
- `pnpm --dir packages/ax-code run build`
