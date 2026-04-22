# ax-code v4.0.8

This release republishes the normal-mode TUI first-submit hardening with the release pipeline aligned to the new logging contract.

## Highlights

- Keeps the packaged-install fix for normal-mode session startup where the first prompt could hang at `Creating session...` while debug mode worked.
- Preserves the run-scoped and component-scoped normal-mode log naming used to avoid main/worker log basename collisions.
- Keeps worker RPC failures fail-fast so the caller gets an explicit error instead of waiting on a silent timeout.
- Aligns the boot logging test with the new stamped log naming contract so release CI matches the shipped runtime behavior.

## Verification

- `pnpm --dir packages/ax-code exec bun test test/cli/boot.test.ts test/util/log.test.ts test/util/rpc.test.ts`
- `pnpm --dir packages/ax-code exec tsc --noEmit --pretty false --incremental false --project tsconfig.json`
- `CI=1 pnpm --dir packages/ax-code run test:ci -- deterministic`
