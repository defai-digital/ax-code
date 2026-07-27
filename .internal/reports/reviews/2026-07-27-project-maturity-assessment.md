# Project Maturity Assessment — v7.4.0

**Date:** 2026-07-27  
**Revised:** 2026-07-27 (fact-check + module-map expansion)  
**Scope:** Full-repo maturity review by module  
**Method:** Static analysis (`git ls-files` / `find` + `wc -l`, test file counts, debt markers, stratified Rust panic signals)

## Overall verdict

**Production-grade, late-maturity product** on the core CLI / TUI / server path. Strong signals:

- 1,065 `*.test.ts` files across the repo
- 10 CI pipelines (CodeQL, perf, release, install-matrix smoke, desktop, VS Code, repo structure)
- TypeScript `strict: true` (core package); husky pre-commit (secret scan + model snapshot regen)
- Layered test groups with explicit quarantine set
- 5 PRDs + 4 ADRs in `.internal/`
- 43 TODO/FIXME across hundreds of thousands of TypeScript lines = exceptional cleanliness

**Gaps:** no CHANGELOG; Rust FFI crates with high `unwrap`/`expect` density in `src/`; several shared packages with zero tests; desktop UI still the largest test:LOC risk; observability (`telemetry/`) thin for enterprise ops.

## Legend

- **Maturity:** ⬤⬤⬤⬤⬤ production / ⬤⬤⬤⬤○ mature / ⬤⬤⬤○○ solid / ⬤⬤○○○ emerging / ⬤○○○○ skeleton
- **Tests** = matching `*.test.ts` (or package-local `*.test.*`) under `packages/ax-code/test` or colocated; **Debt** = TODO/FIXME (TS) or unwrap/expect/panic (Rust `src/`)

## Core Runtime (`packages/ax-code/src`)

### Primary product surfaces

| Module | Files | Lines | Tests | Debt | Maturity | Notes |
|---|---:|---:|---:|---:|:---:|---|
| `cli/` | 329 | 55,203 | 215 | 2 | ⬤⬤⬤⬤⬤ | Largest surface, heavily covered |
| `session/` | 133 | 25,017 | 137 | 11 | ⬤⬤⬤⬤⬤ | Durable/replay/compaction/super-long/scheduled; debt is real (11 TODO) |
| `tool/` | 78 | 14,467 | 70 | 1 | ⬤⬤⬤⬤⬤ | ~1:1 test ratio, near-zero debt |
| `provider/` | 50 | 10,824 | 33 | 0 | ⬤⬤⬤⬤⬤ | Zero debt; SessionRetry-owned retries |
| `server/` (HTTP/SSE) | 50 | 10,110 | 35 | 0 | ⬤⬤⬤⬤⬤ | Clean; OpenAPI-generated contract |
| `lsp/` | 34 | 6,295 | 29 | 0 | ⬤⬤⬤⬤○ | Solid; some flakiness noted in test-group |
| `code-intelligence/` | 12 | 4,962 | 16 | 0 | ⬤⬤⬤⬤○ | Graph-backed, well-tested |
| `config/` | 11 | 3,704 | 12 | 0 | ⬤⬤⬤⬤⬤ | Layered + trust-scoped |
| `mcp/` | 11 | 3,316 | 15 | 0 | ⬤⬤⬤⬤○ | Good coverage for newer surface |
| `graph/` | 2 | 1,030 | 24 | 0 | ⬤⬤⬤⬤○ | Thin code, heavy tests |
| `storage/` (SQLite/Drizzle) | 8 | 1,447 | 6 | 0 | ⬤⬤⬤○○ | Small, lean; minimal tests for critical path |
| `permission/` | 5 | 943 | 11 | 0 | ⬤⬤⬤⬤○ | Critical path, well-tested |
| `isolation/` | 2 | 625 | 6 | 0 | ⬤⬤⬤○○ | Thin; sandbox modes need ongoing scrutiny |

### Orchestration, quality, and adjacent runtime

These were easy to under-count if maturity is judged only by the `agent/` folder name. Multi-agent / quality work lives across several modules.

| Module | Files | Lines | Tests | Debt | Maturity | Notes |
|---|---:|---:|---:|---:|:---:|---|
| `quality/` | 95 | **22,768** | 65 | 0 | ⬤⬤⬤⬤○ | Largest non-cli/session surface; DRE graph + critics |
| `workflow/` | 20 | 6,056 | 22 | 0 | ⬤⬤⬤⬤○ | Multi-step workflow engine + SQL state |
| `runtime/` | 19 | 2,505 | 25 | 0 | ⬤⬤⬤⬤○ | Headless/replay runners |
| `control-plane/` | 17 | 2,344 | 13 | 0 | ⬤⬤⬤○○ | Control-plane surface; solid tests |
| `planner/` | 10 | 2,149 | 11 | 0 | ⬤⬤⬤⬤○ | Plan/replan/verification stack |
| `memory/` | 11 | 1,998 | 11 | 0 | ⬤⬤⬤⬤○ | Session/project memory |
| `agent/` | 2 | 854 | 24 | 0 | ⬤⬤⬤⬤○ | Definitions/router only; orchestration in planner/workflow/dispatch |
| `dispatch/` | 1 | 373 | 5 | 0 | ⬤⬤⬤○○ | Thin adapter; covered via workflow/planner tests |
| `worktree/` | 2 | 939 | 3 | 0 | ⬤⬤⬤○○ | Isolation worktrees |
| `skill/` | 4 | 873 | 6 | 0 | ⬤⬤⬤○○ | Skills runtime |
| `risk/` | 1 | 564 | 8 | 0 | ⬤⬤⬤⬤○ | Small, well-tested |
| `snapshot/` | 1 | 569 | 6 | 0 | ⬤⬤⬤○○ | |
| `pty/` | 2 | 532 | 3 | 0 | ⬤⬤⬤○○ | |
| `hooks/` | 1 | 349 | 2 | 0 | ⬤⬤○○○ | |
| `telemetry/` | 2 | 270 | 1 | 0 | ⬤⬤○○○ | **Thin for enterprise ops** |
| `bus/` | 3 | 214 | 2 | 0 | ⬤⬤⬤○○ | |
| `shell/` | 1 | 110 | 4 | 0 | ⬤⬤⬤○○ | |

**Orchestration takeaway:** Do not rate multi-agent maturity from `agent/` alone (~854 LOC). Combined `agent` + `planner` + `dispatch` + `workflow` is ~9.4k LOC with substantial tests (~60 related test files under agent/planner/dispatch/workflow paths).

## Native Rust Crates (`crates/`)

Unwrap counts below are **`src/` only** (examples/benches excluded). Totals including examples are noted where material.

| Crate | Files | Lines | Tests (`#[test]`) | Unwraps in `src/` | Maturity | Notes |
|---|---:|---:|---:|---:|:---:|---|
| `ax-code-index` | 13 | 2,419 | 30 | **116** (+19 in examples) | ⬤⬤⬤○○ | High unwrap density on FFI-adjacent store path |
| `ax-code-fs` | 6 | 3,137 | 33 | **118** | ⬤⬤⬤○○ | Worst production unwrap density; needs Result propagation |
| `ax-code-diff` | 4 | 1,355 | 25 | 14 | ⬤⬤⬤⬤○ | Good |
| `ax-code-terminal` | 2 | 942 | 24 | **0** | ⬤⬤⬤⬤⬤ | Cleanest crate |
| `ax-code-parser` | 2 | 906 | 9 | 11 | ⬤⬤⬤○○ | Fewer tests, some unwraps |
| `ax-code-daemon` | 3 | 409 | **0** | 2 | ⬤⬤○○○ | File-scanner over Unix socket; **no unit tests**; not a process supervisor |

## SDK & Desktop

| Package | Files | Lines | Tests | Debt | Maturity | Notes |
|---|---:|---:|---:|---:|:---:|---|
| `sdk/js` | 132 | 91,576 | 20 | 3 | ⬤⬤⬤⬤○ | Heavy generated surface; CI drift check on OpenAPI artifacts |
| `desktop/ui` | 755 | **206,492** | **224** | 20 | ⬤⬤⬤○○ | Largest blast radius; 224 colocated tests help but test:LOC still low |
| `desktop/web` | 160 | 43,568 | **87** | — | ⬤⬤⬤○○ | Express/local runtime + scheduled-tasks server; **not** untested |
| `desktop/electron` | 35 | 5,553 | **27** | — | ⬤⬤⬤○○ | Real `src/` + scripts (main, preload, policy modules); not a zero-src shell |
| `opentui-core` | 119 | 8,295 | 0 | — | ⬤⬤⬤○○ | Vendored TUI framework |
| `opentui-solid` | 23 | 503 | 0 | — | ⬤⬤○○○ | Vendored |
| `opentui-spinner` | 4 | 464 | 0 | — | ⬤⬤○○○ | Vendored |

## Other Packages

| Package | Lines | Tests | Maturity | Notes |
|---|---:|---:|:---:|---|
| `integration-vscode` | 1,736 | 6 | ⬤⬤⬤○○ | Functional, light tests |
| `integration-github` | **1,147** | 0 | ⬤⬤○○○ | `index.ts` + `action.yml` present (not “no src”) |
| `ax-wiki` | 1,679 | 3 | ⬤⬤○○○ | Semantic compiler, niche |
| `plugin` | 482 | 0 | ⬤⬤○○○ | Types/runtime, no tests |
| `util` | 430 | 0 | ⬤⬤○○○ | Small pure helpers; low ROI but easy wins |
| `script` | 74 | 0 | ⬤⬤○○○ | Build helpers |

## Cross-Cutting Signals

| Dimension | Status | Evidence |
|---|:---:|---|
| CI/CD | ⬤⬤⬤⬤⬤ | 10 pipelines incl. CodeQL, perf, release, install-matrix, desktop, VS Code |
| Test infrastructure | ⬤⬤⬤⬤⬤ | 1,065 test files; unit/deterministic/e2e/live/recovery groups; quarantine set |
| Type safety | ⬤⬤⬤⬤○ | `strict: true`; core has `noUncheckedIndexedAccess: false` (root config differs) |
| Security scanning | ⬤⬤⬤⬤⬤ | CodeQL + pre-commit secret scan + SECURITY.md (241 lines) |
| Governance | ⬤⬤⬤⬤○ | 5 PRDs + 4 ADRs; **no CHANGELOG** |
| Documentation | ⬤⬤⬤○○ | README 284L, AGENTS 116L; contributor architecture docs uneven |
| Observability | ⬤⬤○○○ | `telemetry/` ~270 LOC / 1 test |
| Code cleanliness | ⬤⬤⬤⬤⬤ | 43 TODO/FIXME in TS = exceptional |

## Are we "product-level"?

**Yes — at v7.4.0 this is shipping-grade for the core CLI/TUI/server path.** The modules that matter most for interactive end users (`cli`, `session`, `tool`, `provider`, plus strong `quality` / `workflow` / `planner`) are mature.

Desktop is a real product path (web + electron with tests), but maturity is lower than core because of UI scale and uneven coverage density—not because electron/web are empty shells.

## Top gaps to close before fully enterprise-ready

1. **Rust FFI hardening** — `ax-code-index` (116) + `ax-code-fs` (118) unwraps in `src/` can panic the host process. Prefer `Result` propagation at N-API boundaries.
2. **Desktop UI test:LOC ratio** — ~206k lines with 224 tests remains the largest product blast radius.
3. **Zero-test shared packages** — `util/`, `plugin/`, `ax-code-daemon`, `integration-github` need at least smoke/unit coverage.
4. **CHANGELOG + upgrade narrative** — missing for a v7.x shipping product.
5. **Ops surfaces** — thin `telemetry/`; process supervision and durable scheduling for unattended runs (see long-run resilience review); keep `isolation/` under security review.

## Measurement methodology

- Counts via tracked source under package trees (excluding `node_modules` / `dist` / `target`).
- Test files = `*.test.ts` unless noted (desktop also uses `*.test.js` / `*.test.mjs`).
- TODO/FIXME debt via recursive grep over `*.ts` / `*.tsx`.
- Rust unwrap/panic via `grep -E '\.unwrap\(\)|\.expect\(|panic!|unimplemented!|todo!'` on `src/` (examples reported separately).
- Maturity ratings combine coverage ratio, debt density, error-handling quality, and surface completeness—not LOC alone.
- **Revision notes (2026-07-27):** Expanded omitted modules (`quality/`, orchestration stack, etc.); corrected desktop electron/web and `integration-github` rows; stratified Rust unwraps; fixed PRD/ADR counts (5+4).
