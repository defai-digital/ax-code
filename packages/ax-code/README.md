# ax-code CLI

This package contains the main AX Code CLI and backend.

## Development

Install dependencies from the repo root:

```bash
pnpm install
```

Run the CLI from this package with Bun:

```bash
bun run ./src/index.ts
```

Or use the root workspace wrapper:

```bash
pnpm dev
```

## Testing

Run commands from `packages/ax-code`:

```bash
bun test
bun typecheck
bun run test:unit
bun run test:recovery
bun run test:e2e
bun run test:deterministic
bun run test:live
bun run test:risk
```

### Test Groups

- `test:unit` runs fast local unit coverage.
- `test:recovery` targets malformed persistence, resume, and storage self-heal paths.
- `test:e2e` covers real CLI and control-plane flows.
- `test:deterministic` runs the non-live CI lane.
- `test:live` is reserved for provider-backed live tests.
- `test:risk` writes the current risk-family summary used by CI.

## CI

GitHub Actions runs the `ax-code` workflow on `packages/ax-code/**` changes.

- PRs and pushes to `dev` run the deterministic lane: typecheck, grouped deterministic tests, and risk summary artifact upload.
- `workflow_dispatch` can optionally run the live lane.

Reports are written under `packages/ax-code/.tmp/test-report`.
