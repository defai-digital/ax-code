# ax-code v4.0.2

This patch release fixes the npm publish regression that blocked the `v4.0.1` release workflow before release asset upload and Homebrew update.

## Highlights

- Hardened release packaging scripts to use `npm pack --workspaces=false` so monorepo workspace discovery cannot break dist packaging.
- Added a regression test covering publish scripts so release packaging flows do not silently regress back to workspace-sensitive pack commands.

## Verification

- `pnpm --dir packages/ax-code exec bun test test/script/publish-script.test.ts test/script/publish-plan.test.ts`
- `pnpm --dir packages/ax-code run typecheck`
- `npm pack --workspaces=false --dry-run` in `packages/ax-code/dist/ax-code-darwin-arm64`
