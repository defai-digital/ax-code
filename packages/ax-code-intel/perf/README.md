# AX Code Intel — performance baseline harness

Phase 0 of the intel stabilization milestone (see
`.internal/prd/PRD-2026-08-21-ax-code-intel-stabilization-acceleration.md`, D4):
a manual-only benchmark harness that records the performance baseline every
later phase is judged against. It is a script plus fixture tree — no product
code changes except one additive field (`peakRssKb`) on `src/perf.ts`'s
`PerfRow`.

## Prerequisites

The harness measures real language servers; install at least one:

| Language | Server binary                | Fixture          |
| -------- | ---------------------------- | ---------------- |
| JS/TS    | `typescript-language-server` | `js-ts-monorepo` |
| Python   | `pyright-langserver`         | `python-project` |
| Rust     | `rust-analyzer`              | `rust-workspace` |

A preflight at startup reports availability per language — resolving the
binary on PATH and probing it with `--version`, so a binary that exists but
cannot run (e.g. a rustup proxy whose toolchain lacks the rust-analyzer
component) is reported as BROKEN rather than found — and skips fixtures whose
server is unavailable. With zero working servers the harness exits non-zero.
The harness never downloads servers (`disableLspDownload` is forced on in its
host).

## Running

```bash
pnpm run perf:intel          # all scenarios, smoke profile, synthetic fixtures
pnpm run perf:intel:smoke    # same as above (explicit)
pnpm run perf:intel:full     # full profile, writes a recorded baseline

# Individual scenarios and options:
tsx packages/ax-code-intel/perf/src/harness.ts --scenario cold-start
tsx ... --scenario full --external --record       # include pinned external fixtures
tsx ... --compare perf/baseline/baseline.reference.json
tsx ... --compare ... --fail-on-regression --threshold 20
```

Scenarios: `cold-start`, `warm-query`, `peak-rss`, `cache-hit-rate`,
`diagnostic-latency`, `graph-builder`. `smoke` runs all six with small
iteration counts (3 cold starts, 5 warmup + 20 measured queries, 5 diagnostic
iterations); `full` uses the recording counts (5 / 10 + 50 / 10).

Profiles and timeouts: `--timeout <ms>` sets the per-query RPC budget
(default 5000); `--cold-timeout <ms>` sets the spawn + initialize budget per
launch (default 60000, enforced by the harness on top of the client's own
initialize timeout so a silently dying server fails cleanly).

## What each scenario measures

| Scenario              | Metric                                                        | How                                                                                                         |
| --------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `cold-start`          | p50/p95 of spawn + `initialize` wall time                     | Fresh server process per launch, N launches, teardown between                                               |
| `warm-query:<method>` | Steady-state p50/p95 for hover / definition / references      | One server lifetime; warmup queries discarded, then N measured per method                                   |
| `peak-rss`            | Peak RSS (KB) of the server process during the warm-query run | 100 ms poller (`/proc` on Linux, `ps` on macOS)                                                             |
| `cache-hit-rate`      | Post-warmup hit share of the cache-probe path                 | Warm pass, repeat pass (hits), one-line edit (miss), repeat (re-hit); counts come from the perf ring buffer |
| `diagnostic-latency`  | didChange → publishDiagnostics round-trip p50/p95             | One-line edit per iteration against the fixture's diagnostic file                                           |
| `graph-builder`       | Wall time + LSP RPC count of a touch-driven file crawl        | `notify.open` across every source file, counting connection messages                                        |

All scenarios drive the real production path: server defs spawn the process,
`LSPClient` handles the protocol, and queries go through the same
`point`/`references`/`cache-probe` modules the `LSP` facade uses. The harness
injects a minimal host (`perf/src/host.ts`) — no downloads, an in-memory
cache store, no-op event bus.

Instrumentation note: `metered()`/ring-buffer overhead and the diagnostic
debounce are constant additive factors. Treat results as relative deltas
against the reference baseline, not absolute truths.

## Fixtures

- **Synthetic** (`fixtures/synthetic/`): checked in, tiny, deterministic,
  license-clean. `manifest.json` pins a sha256 per file plus precomputed LSP
  query points; `perf/test/fixtures.test.ts` fails on any drift. After an
  intentional edit, refresh hashes with
  `tsx packages/ax-code-intel/perf/src/fixtures.ts --write-manifest` and keep
  query points in sync. The harness copies fixtures into a temp dir
  (`AX_CODE_PERF_TMP` overrides the temp root) before running, so servers
  never dirty the source tree.
- **External** (`fixtures/external.json`): real-world repos pinned by commit
  SHA, used only with `--external`. A `null` SHA fails fast — pin a commit
  first. External fixtures have no pinned query points, so they run
  `cold-start` and `graph-builder` only.

## Recording and refreshing the baseline

`--record` writes `baseline/baseline-<YYYYMMDD>-<host>-node<major>.json`.
The directory is gitignored except `*.reference.json`: to promote a run to
the reference, rename/copy it to `baseline.reference.json` and commit it in a
PR with one reviewer. The reference is always the most recent recorded
baseline; Phase 3 exit criteria quote deltas against it.

`--compare <file>` prints a delta table (p50/p95/peakRSS/hitRate/RPC/total).
Exit code is non-zero only with `--fail-on-regression` and a metric degraded
beyond `--threshold` percent (default 20; hit rate counts a _drop_).

## CI policy

Manual-only. The harness is not in `ax-code-ci.yml`, `test:scripts`,
`test:extracted-packages`, or any Turbo pipeline, and the perf tests have
their own vitest config so `pnpm --dir packages/ax-code-intel test` does not
pick them up:

```bash
pnpm --dir packages/ax-code-intel exec vitest run --config perf/vitest.config.ts
```

A nightly `workflow_dispatch` workflow may be added later; when it is, it
must record runner class and Node version in the baseline meta (already
captured) and stay out of required checks.

## Worked example

After a prewarm-policy tweak on a machine with rust-analyzer:

```
pnpm run perf:intel:full            # writes baseline-20260822-dev-node26.json
tsx ... --compare perf/baseline/baseline.reference.json
# | cold-start | rust | rust | p95 | 1870 | 1640 | -12.3% |  |
```

The cold-start p95 dropped from 1870 ms to 1640 ms; no regression flags. If
the change is kept, record a fresh baseline and promote it to
`baseline.reference.json` via the PR process above.
