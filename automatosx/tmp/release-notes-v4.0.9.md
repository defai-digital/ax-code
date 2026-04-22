# ax-code v4.0.9

This release fixes a normal-mode TUI startup regression where the first prompt could still hang on packaged installs even though debug mode succeeded.

## Highlights

- Removes an unnecessary terminal palette probe from the default startup path when the active theme is not `system`.
- Keeps terminal OSC palette detection deferred and scoped to actual `system` theme usage instead of touching the TTY during ordinary startup.
- Preserves the earlier first-submit hardening while eliminating another normal-vs-debug runtime difference on real terminals.
- Adds a guardrail test so non-system themes do not regress back into probing terminal palette state during app startup.

## Verification

- `pnpm --dir packages/ax-code exec bun test test/cli/tui/render-anti-patterns.test.ts test/cli/tui/no-console.test.ts`
- `pnpm --dir packages/ax-code exec tsc --noEmit --pretty false --incremental false --project tsconfig.json`
- `pnpm --dir packages/ax-code run build`
