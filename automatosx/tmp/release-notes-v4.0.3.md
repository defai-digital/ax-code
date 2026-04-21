# ax-code v4.0.3

This patch release fixes the CI-only regression in the publish-script guardrail test so the release workflow can advance beyond deterministic tests.

## Highlights

- Switched the publish-script regression test to repo-relative paths so it passes on GitHub-hosted runners instead of depending on a local absolute workspace path.
- Keeps the `npm pack --workspaces=false` release-packaging fix from `v4.0.2` and validates it in deterministic CI.

## Verification

- `pnpm --dir packages/ax-code exec bun test test/script/publish-script.test.ts test/script/publish-plan.test.ts`
- `CI=1 pnpm --dir packages/ax-code run test:ci -- deterministic`
