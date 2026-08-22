# @ax-code/ax-code-reason

Deterministic debugging and refactoring reasoning engine for AX Code.

This package implements the non-LLM reasoning layer: debug case management
(open case, capture evidence, propose hypotheses, plan instrumentation, apply
verification), runtime log routing, native/static scanners (hardcodes,
lifecycle, races, security), duplicate detection, impact analysis, safe
refactor planning/application, shadow worktrees, and the quality finding /
verification-envelope model. Like `@ax-code/ax-code-intel` it is
environment-agnostic: host-specific concerns are injected through the host
port in `src/host.ts`, and the AX Code core wires the production host in
`packages/ax-code/src/dre-glue.ts`.

## Public API

The `exports` map in `package.json` is the contract. Anything not listed
there is not importable.

| Subpath                         | Exports                                                | Stability |
| ------------------------------- | ------------------------------------------------------ | --------- |
| `.`                             | top-level facade                                       | stable    |
| `host`                          | `ReasonHost` port + configuration                      | stable    |
| `id`                            | branded identifier helpers                             | evolving  |
| `query`                         | query layer over the reason store                      | evolving  |
| `runtime-debug`                 | debug case lifecycle (open/evidence/hypothesis/verify) | evolving  |
| `analyze-bug`                   | bug analysis                                           | evolving  |
| `analyze-impact`                | change impact analysis                                 | evolving  |
| `detect-duplicates`             | duplicate code detection                               | evolving  |
| `diagnostic-correlation`        | LSP diagnostic ↔ debug-case correlation               | evolving  |
| `language-scan`                 | per-language scan dispatch                             | evolving  |
| `native-scan`                   | native (Rust addon) scanner bridge                     | evolving  |
| `plan-refactor`                 | refactor planning                                      | evolving  |
| `prewarm-lsp`                   | LSP prewarm integration for analysis                   | evolving  |
| `scanner-utils`                 | shared scanner utilities                               | evolving  |
| `shadow-worktree`               | shadow worktree management                             | evolving  |
| `verification-runner`           | verification command runner                            | evolving  |
| `verify-after-fix`              | post-fix verification                                  | evolving  |
| `quality/digest`                | quality digest model                                   | evolving  |
| `quality/finding`               | finding model                                          | evolving  |
| `quality/finding-registry`      | finding registry                                       | evolving  |
| `quality/verification-envelope` | verification envelope model                            | evolving  |

Stability tiers:

- **stable** — semantic-versioned; no breaking changes without a major bump.
- **evolving** — current contract; breaking changes are allowed in minor
  versions but require a CHANGELOG entry.
- **internal-only** — everything under `src/internal/`. Not part of the API
  surface, not exported, and may change without notice.

> Temporary exceptions: `./internal/log` and `./internal/process` are
> currently exported for the AX Code core glue
> (`packages/ax-code/src/dre-glue.ts`) and one legacy core test
> (`packages/ax-code/test/planner/verification-runner.test.ts`). These are
> migration seams, not API — unsupported for any other consumer and tracked
> for removal. Do not take a dependency on them.

## Lifecycle guarantees

- The public API follows semver. The package is at `0.x`, so breaking changes
  are permitted in minor versions; from `1.0.0` they require a major bump
  plus a migration note in the CHANGELOG.
- `internal/*` is **not** API. Importing it from outside the package is
  unsupported and may break without notice (the temporary exceptions are
  listed above).
- This package depends on `@ax-code/ax-code-intel` (workspace). Any breaking
  change in intel's public API propagates here as a reason major bump (minor
  while both are `0.x`).

## Testing

```bash
pnpm --dir packages/ax-code-reason test
```

runs the package's unit tests (`test/`). Integration tests that exercise the
engine through the AX Code core (debug tools, quality routes, session risk)
live in `packages/ax-code/test/debug-engine/`, `test/tool/`, and
`test/quality/` and run with the core suite.

## Architecture

This package is a sibling of `@ax-code/ax-code-intel`, extracted from the AX
Code core under the same stabilization effort. The governing PRD
(`.internal/prd/PRD-2026-08-21-ax-code-intel-stabilization-acceleration.md`,
repo-internal) covers intel directly and scopes this package's D5 contract
work (explicit export maps, lifecycle documentation); the reasoning engine
itself predates that PRD and is not otherwise described by it.
