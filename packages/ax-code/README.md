# ax-code CLI

This package contains the main AX Code CLI and backend.

## Development

Use Node.js 26 or later and the pnpm version specified in the root manifest.
From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm run dev
```

The root launcher compiles the workspace SDK before starting the CLI and loads
the repository's local `.env` when present. Run `pnpm dev` from
`packages/ax-code` if the workspace SDK has already been built.

## Testing

Run commands from `packages/ax-code`:

```bash
pnpm test
pnpm typecheck
pnpm test:unit
pnpm test:recovery
pnpm test:e2e
pnpm test:deterministic
pnpm test:live
pnpm test:risk
pnpm test:ci -- deterministic --coverage --coverage-summary-out ../../.internal/reports/testing/coverage-summary.json --coverage-report-out ../../.internal/reports/testing/coverage-report.md
pnpm perf:index --config perf-index.jsonc
```

To run a single test file, use `AX_TEST_FILES` (comma-separated) — positional
vitest filters are unreliable in vitest 4:

```bash
AX_TEST_FILES=test/session/foo.test.ts pnpm exec vitest run
```

### Test Groups

- `test:unit` runs fast local unit coverage.
- `test:recovery` targets malformed persistence, resume, and storage self-heal paths.
- `test:e2e` covers real CLI and control-plane flows.
- `test:deterministic` runs the non-live CI lane.
- `test:live` is reserved for provider-backed live tests.
- `test:risk` writes the current risk-family summary to `.internal/reports/testing/`.
- `test:ci -- deterministic --coverage` writes JUnit, LCOV, machine-readable, and markdown reports to `.internal/reports/testing/`.

## Performance

Run the repeatable index benchmark from `packages/ax-code`:

```bash
pnpm perf:index --config perf-index.jsonc
```

Common overrides:

```bash
pnpm perf:index --config perf-index.jsonc --limit 25 --repeat 5 --warmup 1
pnpm perf:index --config perf-index.jsonc --max-elapsed-median-ms 2000 --max-phase-median-ms lsp.touch=800
pnpm perf:index --config perf-index.jsonc --baseline ../../.internal/reports/performance/perf-index-baseline.json --max-elapsed-regression-pct 20
pnpm perf:index --config perf-index.jsonc --baseline ../../.internal/reports/performance/perf-index-baseline.json --baseline-summary ../../.internal/reports/performance/perf-index-baseline-summary.json --max-elapsed-regression-pct 20
pnpm perf:index --config perf-index.jsonc --summary-out ../../.internal/reports/performance/perf-index-summary.json --write-baseline ../../.internal/reports/performance/perf-index-baseline.json
pnpm perf:index --config perf-index.jsonc --write-baseline ../../.internal/reports/performance/perf-index-baseline.json --write-baseline-summary ../../.internal/reports/performance/perf-index-baseline-summary.json
pnpm perf:report --summary ../../.internal/reports/performance/perf-index-summary.json --out ../../.internal/reports/performance/perf-index-report.md
```

`perf-index.jsonc` is the checked-in policy file for benchmark defaults, absolute gates, optional baseline comparison, and the default machine-readable summary path.

Artifacts:

- `.internal/reports/performance/perf-index.json` stores the raw benchmark report.
- `.internal/reports/performance/perf-index-summary.json` stores the machine-readable verdict used by CI or downstream automation.
- `.internal/reports/performance/perf-index-report.md` stores the human-readable markdown report artifact.
- `--write-baseline` writes the current report to a baseline file so the next run can compare against it.
- `--write-baseline-summary` writes the promoted baseline's sidecar verdict with provenance metadata.
- `--baseline-summary` lets you override the baseline sidecar summary path; otherwise `perf-index` infers `<baseline>-summary.json`.
- When a baseline is provided, the markdown report includes top regressions and improvements by phase for triage.
- Verdict and markdown report include provenance such as timestamp, config path, git branch/commit, runtime, and CI context when available.
- Baseline compatibility checks use provenance to catch mismatched directory, config path, and runtime platform/arch before trusting numeric regressions.

## CI

The `ax-code` workflow selects checks for changes to the CLI, its workspace
dependencies, and shared tooling. It runs typechecking and scans, eight
deterministic shards, runtime contract tests, and advisory integration and
quarantine checks. The deterministic jobs upload JUnit and risk reports.
V8 coverage is opt-in. To enable it locally, pass `--coverage`; on GitHub Actions
also set `AX_TEST_COVERAGE=1`.

Manual dispatch can enable the live tests. The separate `ax-code-perf` workflow
runs benchmark sampling and optional regression gates, then uploads the results
and any requested baseline.

Local test reports are written under `.internal/reports/testing/`, including JUnit
files in `.internal/reports/testing/junit/`.
