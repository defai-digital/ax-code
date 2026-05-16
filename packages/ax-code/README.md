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
bun run test:ci -- deterministic --coverage --coverage-summary-out .tmp/coverage-summary.json --coverage-report-out .tmp/coverage-report.md
bun run perf:index --config perf-index.jsonc
```

### Test Groups

- `test:unit` runs fast local unit coverage.
- `test:recovery` targets malformed persistence, resume, and storage self-heal paths.
- `test:e2e` covers real CLI and control-plane flows.
- `test:deterministic` runs the non-live CI lane.
- `test:live` is reserved for provider-backed live tests.
- `test:risk` writes the current risk-family summary used by CI.
- `test:ci -- deterministic --coverage` writes LCOV plus machine-readable and markdown coverage summaries under `.tmp/`.

## Performance

Run the repeatable index benchmark from `packages/ax-code`:

```bash
bun run perf:index --config perf-index.jsonc
```

Common overrides:

```bash
bun run perf:index --config perf-index.jsonc --limit 25 --repeat 5 --warmup 1
bun run perf:index --config perf-index.jsonc --max-elapsed-median-ms 2000 --max-phase-median-ms lsp.touch=800
bun run perf:index --config perf-index.jsonc --baseline .tmp/perf-index-baseline.json --max-elapsed-regression-pct 20
bun run perf:index --config perf-index.jsonc --baseline .tmp/perf-index-baseline.json --baseline-summary .tmp/perf-index-baseline-summary.json --max-elapsed-regression-pct 20
bun run perf:index --config perf-index.jsonc --summary-out .tmp/perf-index-summary.json --write-baseline .tmp/perf-index-baseline.json
bun run perf:index --config perf-index.jsonc --write-baseline .tmp/perf-index-baseline.json --write-baseline-summary .tmp/perf-index-baseline-summary.json
bun run perf:report --summary .tmp/perf-index-summary.json --out .tmp/perf-index-report.md
```

`perf-index.jsonc` is the checked-in policy file for benchmark defaults, absolute gates, optional baseline comparison, and the default machine-readable summary path.

Artifacts:

- `.tmp/perf-index.json` stores the raw benchmark report.
- `.tmp/perf-index-summary.json` stores the machine-readable verdict used by CI or downstream automation.
- `.tmp/perf-index-report.md` stores the human-readable markdown report artifact.
- `--write-baseline` writes the current report to a baseline file so the next run can compare against it.
- `--write-baseline-summary` writes the promoted baseline's sidecar verdict with provenance metadata.
- `--baseline-summary` lets you override the baseline sidecar summary path; otherwise `perf-index` infers `<baseline>-summary.json`.
- When a baseline is provided, the markdown report includes top regressions and improvements by phase for triage.
- Verdict and markdown report include provenance such as timestamp, config path, git branch/commit, runtime, and CI context when available.
- Baseline compatibility checks use provenance to catch mismatched directory, config path, and runtime platform/arch before trusting numeric regressions.

## CI

GitHub Actions runs the `ax-code` workflow on `packages/ax-code/**` changes.

- PRs and pushes to `dev` run the deterministic lane: typecheck, grouped deterministic tests, risk summary artifact upload, and coverage artifact upload.
- The deterministic lane writes `packages/ax-code/.tmp/coverage/lcov.info`, `packages/ax-code/.tmp/coverage-summary.json`, and `packages/ax-code/.tmp/coverage-report.md`.
- PR workflows try to download the latest successful `dev` coverage summary and include line/function trend deltas in the step summary. Branch trend is reported as unavailable until the Bun LCOV reporter emits branch counters.
- `workflow_dispatch` can optionally run the live lane.
- `ax-code-perf` is a separate manual workflow for perf sampling, optional regression gating, machine-readable summary upload, markdown report upload, and optional baseline promotion. It uploads the raw report, the verdict JSON, the markdown report, and optionally a promoted baseline artifact plus baseline summary artifact.

Reports are written under `packages/ax-code/.tmp/test-report`.
