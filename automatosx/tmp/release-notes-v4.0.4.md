# ax-code v4.0.4

This patch release fixes the remaining npm publish workspace-resolution failure that blocked `v4.0.3` from reaching npm and Homebrew.

## Highlights

- Adds `--workspaces=false` to the `npm publish` calls used by the CLI, SDK, and plugin release scripts so publish no longer walks the parent monorepo workspace graph.
- Keeps the earlier `npm pack --workspaces=false` guardrail and extends the regression test to cover both pack and publish paths.
- Includes the release-flow hardening from `v4.0.3` follow-up work so stable releases require a clean, verified path before tagging.

## Verification

- `pnpm --dir packages/ax-code run typecheck`
- `CI=1 pnpm --dir packages/ax-code run test:ci -- deterministic`
- `pnpm --dir packages/ax-code exec bun test test/script/publish-script.test.ts test/script/publish-plan.test.ts test/script/root-release-script.test.ts`
