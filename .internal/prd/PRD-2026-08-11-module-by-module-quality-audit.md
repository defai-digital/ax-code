# PRD: Module-by-Module Quality Audit

| Field | Value |
|-------|-------|
| Status | Active |
| Owner | AX Code CLI & Desktop maintainers |
| Created | 2026-08-11 |
| Related | 2026-07-19 code-quality review; AX Code architecture; Desktop project boundaries; runtime and TUI stability programs |
| Location | `.internal/prd/PRD-2026-08-11-module-by-module-quality-audit.md` |

---

## 1. Problem statement

AX Code is a large, multi-surface product: a TypeScript CLI/runtime and server,
an Electron/Desktop stack, generated SDKs, shared packages, vendored terminal UI
packages, and Rust native addons. Broad reviews and incident-driven fixes have
found important defects, but they do not prove that every module has been read,
threat-modeled, tested, and signed off.

The [2026-07-19 code-quality and stability review](../reports/reviews/2026-07-19-code-quality-stability-review.md)
is valuable prior art, not an exhaustive baseline. It explicitly left areas
unreviewed, relied mainly on static reading, and captured a point-in-time set of
findings. Since then, code and boundaries have continued to evolve. Without a
repeatable unit-by-unit program, AX Code risks:

1. wrong design or architectural smells becoming entrenched;
2. performance bottlenecks on session, event, storage, UI, and native hot paths;
3. correctness bugs in retry, cancellation, concurrency, migration, and cleanup paths;
4. dead code, unused exports, unreachable branches, and stale compatibility layers;
5. silent error swallowing through empty catches, detached promises, misleading
   exit codes, or degraded fallbacks without telemetry;
6. duplication, god files, boundary violations, missing validation, and policy/IO
   coupling that make fixes unsafe;
7. security defects at repository, process, renderer, network, filesystem, plugin,
   MCP, provider, and native trust boundaries; and
8. high-risk behavior without regression tests.

This PRD establishes a finite inventory, a common evidence standard, and ordered
risk waves so every in-scope module is audited one by one. Review and repair are
one program: a module is not complete merely because problems were listed.

---

## 2. Goals

### Product goals

- **G1 — Exhaustive coverage:** Every in-scope CLI, Desktop, supporting-package,
  and native audit unit receives its own report and explicit sign-off.
- **G2 — Risk reduction:** Security, data-loss, process-failure, session hot-path,
  and permission-boundary defects are found and closed before polish work.
- **G3 — Evidence-backed quality:** Every accepted finding is reproducible or
  statically proven, tied to current source, and closed with verification evidence.
- **G4 — Reliable failure behavior:** Silent catches, unobserved rejections,
  incorrect exit semantics, and invisible degraded modes are materially reduced.
- **G5 — Measurable improvement:** Coverage, performance, finding closure, and
  boundary health are baselined and tracked through the program.

### Engineering goals

- **E1 — Repeatability:** Reviewers use the same nine-step protocol and templates.
- **E2 — Minimal fixes:** Accepted findings receive the smallest safe fix plus a
  regression test; unrelated refactors do not ride along.
- **E3 — Independent assurance:** Critical findings and their remediations receive
  a second pass by someone other than the original reviewer/fixer.
- **E4 — Architectural alignment:** Reviews enforce
  [`packages/ax-code/ARCHITECTURE.md`](../../packages/ax-code/ARCHITECTURE.md),
  [`desktop/docs/PROJECT_BOUNDARIES.md`](../../desktop/docs/PROJECT_BOUNDARIES.md),
  and root [`AGENTS.md`](../../AGENTS.md).
- **E5 — Durable records:** The planning directory remains the live source of
  truth for scope, module status, evidence, deferrals, and verification.

---

## 3. Non-goals

- Full feature parity with competitors.
- Large rewrites without evidence that a targeted fix cannot restore the required
  invariant.
- Changing AX Code's product vision or inventing new product surfaces during audit.
- Automatically applying Critical security fixes without human review.
- Replacing the 2026-07-19 review. This program continues, re-verifies, and
  systematizes beyond it; it does not present its findings as newly discovered.
- Treating generated output, vendored dependencies, `node_modules/`, `dist/`, or
  `target/` as ordinary hand-written audit units. Their generators, integration
  contracts, provenance, drift checks, and runtime boundaries remain in scope.
- Reaching a universal coverage percentage across low-value presentation code.
  Coverage deltas are required where risk and accepted findings justify them.

---

## 4. Operating principles and fix policy

1. **Security and trust gates precede polish.** A wave may pause when an open
   Critical finding invalidates assumptions used by later reviews.
2. **Prefer minimal, targeted fixes.** Preserve public behavior unless the finding
   proves that behavior unsafe or incorrect.
3. **No drive-by refactors.** Refactoring belongs in the finding's fix only when it
   is necessary to make the invariant testable or the defect safely repairable.
4. **Tests land before or with the fix.** When a failing regression test cannot be
   committed first, the finding records why and shows before/after proof.
5. **Policy and IO stay separated.** New validation or policy decisions should be
   pure where practical; boundary adapters own IO and error translation.
6. **Existing findings retain lineage.** A July-review item is linked as prior art.
   If it still reproduces, its audit record says `Origin: prior-review`; it is not
   counted as a new discovery.
7. **ADRs are for decisions, not parking lots.** Deferred design debt requires an
   ADR only when resolution needs an architectural/product decision. Ordinary
   implementation debt stays in the finding record with owner, rationale, and date.
8. **Generated contracts are rebuilt, not hand-edited.** Server/OpenAPI changes
   include the SDK generation and drift checks required by `AGENTS.md`.

---

## 5. Audit-unit contract and scope inventory

An **audit unit** is the smallest independently mappable ownership boundary in
this program. Every backticked path or named sub-surface below receives its own
status row and module report. A large parent may be split into child reports, but
the parent cannot be signed off until every child rolls up. Wave 0 freezes current
paths, aliases, generated boundaries, owners, and the final denominator; newly
discovered in-scope modules are added rather than silently absorbed into “etc.”

### 5.1 CLI core (`packages/ax-code/src/`)

The following are independent audit units, scheduled in the order shown later in
this PRD:

- `account`, `acp`, `agent`, `audit`, `auth`, `bun`, `bus`, `capability`, `cli`,
  `code-intelligence`, `command`, `config`, `constants`, `context`,
  `control-plane`, `debug-engine`, `debug`, `design-check`, `desktop`, `dispatch`,
  `env`, `file`, `flag`, `format`, `global`, `graph`, `hooks`, `id`, `ide`, `image`,
  `import`, `installation`, `isolation`, `lsp`, `mcp`, `memory`, `mode`, `native`,
  `notification`, `patch`, `perf`, `permission`, `planner`, `plugin`, `project`,
  `prompt-history`, `pty`, `quality`, `question`, `replay`, `risk`, `sdk`, `session`,
  `share`, `shell`, `skill`, `snapshot`, `stats`, `storage`, `telemetry`, `tool`,
  `util`, `visual`, `wiki`, `workflow`, and `worktree`.
- `provider` plus separate `provider/ax-engine`, `provider/cli`, and `provider/xai`
  integration units.
- `runtime` plus separate `runtime/headless` execution-path review.
- `server` plus separate `server/routes` review, split further by route family when
  the Wave 0 inventory requires it.

The `cli` parent includes boot, process lifecycle, registration, output contracts,
and these separately signed-off logical `cli/cmd` units:

1. `account`
2. `acp`
3. `agent`
4. `audit`
5. `branch`
6. `capability`
7. `compare`
8. `context`
9. `db`
10. `debug`
11. `design-check`
12. `doctor` (including health, preload, and storage checks)
13. `dre-graph` (including its server entrypoint)
14. `export`
15. `generate`
16. `github`
17. `github-agent`
18. `graph`
19. `headless-run`
20. `import`
21. `index-graph`
22. `init`
23. `mcp`
24. `memory`
25. `models`
26. `pr`
27. `providers`
28. `release`
29. `replay`
30. `restart`
31. `risk`
32. `rollback`
33. `run` (including output formatting)
34. `runtime`
35. `serve`
36. `session` (including latest/required helpers)
37. `skill`
38. `stats`
39. `storage`
40. `trace`
41. `tui`
42. `uninstall`
43. `upgrade`
44. `webui`
45. `wiki`
46. `workflow`
47. `workspace-serve`
48. command registry and compatibility shims

### 5.2 Supporting packages and native code

- `packages/sdk/js`, `packages/plugin`, `packages/util`, `packages/script`, and
  `packages/ax-wiki`.
- The `packages/opentui-*` family as separate units: `packages/opentui-core`,
  `packages/opentui-solid`, and `packages/opentui-spinner`.
- The `packages/ax-code-*-native` wrapper family and companions as separate units:
  `packages/ax-code-index-core`, `packages/ax-code-fs-native`,
  `packages/ax-code-diff-native`, `packages/ax-code-parser-native`,
  `packages/ax-code-terminal-native`, and `packages/ax-code-daemon`.
- Rust units: `crates/ax-code-index`, `crates/ax-code-fs`, `crates/ax-code-diff`,
  `crates/ax-code-parser`, `crates/ax-code-terminal`, `crates/ax-code-daemon`, and
  the lower-priority `crates/ax-code-bench` harness.

### 5.3 Desktop (`desktop/`)

- `desktop/packages/electron`: shell/window lifecycle, IPC handlers and sender
  policy, preload bridge, server-process lifecycle, tray, updates, and security
  policies are separate units.
- `desktop/packages/web/server` composition plus separate `server/lib` units:
  `ax-code`, `desktop`, `event-stream`, `fs`, `git`, `github`, `magic-prompts`,
  `notifications`, `preview`, `projects`, `quota`, `scheduled-tasks`, `security`,
  `session-folders`, `skills-catalog`, `terminal`, `text`, and `ui-auth`.
- `desktop/packages/web/src`: browser entry and `RuntimeAPIs` adapters.
- `desktop/packages/ui/src`: `api`, `apps`, `components`, `contexts`, `hooks`,
  `lib`, `stores`, `sync`, and `types` are separate units.
- `desktop/packages/docs` is a lower-priority documentation/build unit.

---

## 6. Repeatable per-module audit protocol

Every module report must complete these steps in order. Tool output or a search
hit can seed review, but it does not replace source reading and proof.

### 1. Map

- State the module's purpose, owner, source/test paths, generated or native pieces,
  and user-visible surfaces.
- Enumerate public APIs/exports, command or route registration, callers, callees,
  events, subprocesses, and cross-package imports.
- Record ownership boundaries, config/env/CLI surface, persistence and migrations,
  caches, filesystem/network access, and lifecycle/disposal hooks.
- Draw a small dependency or data-flow diagram when three or more boundaries make
  the behavior hard to explain linearly.

### 2. Threat and failure model

- Identify assets and trust changes: untrusted repositories, user input, model/tool
  input, renderer content, plugins/skills/hooks, MCP/provider traffic, credentials,
  files, database state, subprocesses, native FFI, and update artifacts.
- Enumerate crash, hang, data-loss/corruption, privilege expansion, secret exposure,
  inconsistent state, and silent degradation paths.
- Inspect concurrency races, duplicate delivery, stale callbacks, teardown during
  in-flight work, process death, partial writes, and restart/recovery behavior.

### 3. Correctness review

- Write down invariants and trace success, empty, invalid, retryable, terminal,
  aborted, timed-out, and disposed paths.
- Check validation at boundaries; `Result` versus throw contracts; error translation;
  retries, caps, jitter/backoff; abort propagation; idempotency; and exit codes.
- Verify timers, streams, locks, listeners, child processes, sockets, temp files,
  native handles, and transactions are released on every exit path.

### 4. Performance review

- Identify hot paths and establish a baseline before proposing optimization.
- Check N+1 IO/RPC, repeated parsing or regex compilation, unbounded maps/queues/logs,
  sync work on Node/Electron event loops, avoidable serialization/copies, missing or
  unsafe caches, listener growth, over-rendering, and native fallback costs.
- Record workload, hardware/runtime context, repetitions, variance, and before/after
  measurements for accepted performance findings.

### 5. Design review

- Assess cohesion, coupling, public surface size, god files, duplicated policy,
  layering, circular dependencies, ownership, and testability.
- Separate policy from IO and UI from runtime semantics.
- Enforce core placement rules and Desktop's Electron → web server → browser adapter
  → UI ownership/import boundaries. A large file is a signal, not a finding without
  a demonstrated cost or violated invariant.

### 6. Dead code and hygiene

- Trace unused exports and registrations, unreachable branches, disabled feature
  paths, stale flags, compatibility shims, TODO/FIXME/HACK debt, commented-out code,
  unsafe suppressions/casts, and docs/config/schema drift.
- Confirm dynamic imports, reflection, command registration, build scripts, and
  platform-specific paths before declaring code dead.

### 7. Tests

- Map existing unit, deterministic, integration/e2e, recovery, live-provider,
  Desktop, native, and source-pin coverage to the module's risk paths.
- Add or extend a regression test for every accepted correctness, stability,
  security, or silent-error finding before or with its fix.
- Prefer observable behavior over source-string assertions. Record justified test
  gaps and why a lower-level invariant test is sufficient.

### 8. Fix plan

- Assign severity, category, owner, blast radius, dependencies, and target SLA.
- Describe the smallest fix, compatibility/migration concerns, rollout or rollback,
  regression tests, and exact verification commands.
- Split decision-level architecture changes from immediate containment. Do not hold
  a safe mitigation hostage to a larger redesign.

### 9. Exit criteria

- Re-read modified paths and execute proportionate tests/typechecks/build checks.
- Resolve each accepted finding as `verified-fixed` or `deferred` with the required
  rationale, owner, mitigation, and review date.
- Obtain independent verification for Critical findings and Critical fixes.
- Sign off the module only when its report, finding records, tests, verification,
  metrics, and deferrals are complete. “Reviewed, bugs remain” is not sign-off.

---

## 7. Finding taxonomy, identity, and evidence

### Stable IDs and categories

Finding IDs use `AUDIT-<module-slug>-NNN`, for example
`AUDIT-session-001` or `AUDIT-desktop-electron-ipc-003`. Slugs are fixed in
Wave 0; numbers are monotonic and never reused or renumbered, including after a
finding is rejected or merged as a duplicate.

Exactly one primary category is required:

- `security`
- `correctness`
- `stability`
- `performance`
- `design`
- `dead-code`
- `silent-error`
- `quality`
- `test-gap`

Secondary tags may refine the issue, but dashboards count by primary category.
Finding states are `candidate`, `accepted`, `fixing`, `verification`,
`verified-fixed`, `deferred`, `rejected`, and `duplicate`.

### Evidence standard

Every accepted finding must include:

1. **Source:** repository-relative `path:line` or `path:start-end` plus reviewed
   commit SHA. Generated or moving source may use symbol + generator location.
2. **Proof:** deterministic reproduction with inputs and observed/expected behavior,
   a failing test, logs/trace, benchmark, or a complete static control/data-flow
   argument. A pattern match alone is only a candidate.
3. **Impact:** affected user/system, reachability, severity rationale, blast radius,
   and realistic worst case.
4. **Recommended fix:** concrete invariant-restoring change, alternatives considered,
   compatibility/migration concerns, and why its scope is minimal.
5. **Verification:** regression test and exact command/result; performance findings
   include comparable before/after data, and security fixes include a negative test.

Evidence must be reproducible without exposing credentials or private user data.
Unverified hypotheses stay `candidate` and do not inflate accepted-finding counts.
When prior art already describes the issue, link it, set the origin, and report only
new current-state verification or materially new impact.

---

## 8. Severity rubric and fix SLA

SLA clocks start when a finding is `accepted`; a documented release freeze or
external dependency may pause the clock, but not erase it.

| Severity | Standard | Target response and fix SLA | Deferral policy |
|----------|----------|-----------------------------|-----------------|
| **Critical** | Credible remote/local privilege expansion, secret compromise, arbitrary code execution across a trust boundary, unrecoverable or broad data loss, release-compromise path, or reliable process-wide failure on a normal/reachable path | Triage immediately; contain within 24 hours; verified fix as soon as safely possible and before the affected release/path is enabled | Not ordinarily deferrable. Temporary mitigation requires named owner, expiry, blocked exposure, and security/maintainer approval |
| **High** | Major correctness/security/stability defect affecting common or high-value paths, recoverable data corruption/loss, persistent outage, or serious boundary failure | Triage within 1 business day; verified fix within 3 business days or before the next release, whichever is sooner | Only time-bounded with mitigation, owner, rationale, expiry, and explicit lead approval |
| **Medium** | Material bug, degradation, leak, race, performance regression, design fault, or test gap with limited reach or workaround | Plan in the current wave; target fix within 10 business days | May defer with owner, rationale, trigger/review date, and tracked residual risk |
| **Low** | Localized quality/reliability issue, low-frequency edge case, bounded inefficiency, or maintainability debt with demonstrated cost | Fix in the wave when cheap; otherwise schedule within 30 days/backlog review | May defer with concise rationale and owner; group related cleanup |
| **Nit** | Cosmetic consistency or clarity issue with no material behavior/risk | Opportunistic; no dedicated SLA | Freely batch or decline; must not block sign-off unless it obscures safety/correctness |

Severity is based on impact and reachability, not estimated fix size. A `test-gap`
inherits the severity of the unprotected invariant; it is not automatically Low.

---

## 9. Orchestration and status model

### Review/fix lanes

- Parallel agents or reviewers may map and inspect independent modules concurrently
  in **read-only** mode. Their assignments, baseline SHA, and scope must not overlap
  ambiguously.
- Fixes use a controlled write lane. Each fix lands with affected tests and the
  affected package's typecheck; shared hot files are serialized.
- The original reviewer validates candidates before acceptance. A second reviewer
  independently re-verifies every Critical finding and its remediation from source
  and, where safe, reproduction.
- Cross-module findings have one owning module and linked impacted modules; do not
  duplicate counts. The owner cannot sign off until dependents acknowledge impact.
- Discovery and repair may overlap within a wave, but a later low-risk wave does not
  excuse an overdue Critical/High remediation.

### Module states

`NOT STARTED` → `MAPPING` → `REVIEWING` → `FINDINGS VALIDATION` → `FIXING` →
`VERIFYING` → `SIGNED OFF`.

`BLOCKED` records an external dependency or invalidated prerequisite. `DEFERRED`
is a finding state, not a substitute for module sign-off: the module still completes
the protocol and records the accepted deferral.

The live source of truth is
[`../reports/planning/module-quality-audit/STATUS.md`](../reports/planning/module-quality-audit/STATUS.md).
Module reports and finding records are created from the templates under that
directory. Status changes include date, owner, and evidence link.

---

## 10. Phased plan and ordered module waves

Effort is review/report effort before fixes:

| Band | Expected effort | Rule |
|------|-----------------|------|
| **S** | 0.5–1 reviewer-day | Narrow surface with few boundaries |
| **M** | 1–2 reviewer-days | Several callers or one important lifecycle/boundary |
| **L** | 3–5 reviewer-days | Broad subsystem, concurrency, persistence, or multiple integrations |
| **XL** | More than 5 reviewer-days | Must split into named child reports before review starts |

Estimates are planning ranges, not finding quotas. Detailed checklists and live
completion are in [`PHASES.md`](../reports/planning/module-quality-audit/PHASES.md).

### Wave 0 — Inventory, tooling, and baselines (3–5 reviewer-days)

1. Freeze audit-unit paths/slugs, owners, dependencies, risk tags, generated code,
   native/fallback pairs, and test locations in `STATUS.md`.
2. Record baseline commit, Node/pnpm/Rust versions, module/file/LOC counts, current
   test inventory, typecheck/boundary status, known flaky/quarantined tests, and
   relevant coverage/performance baselines.
3. Establish reproducible scans for empty/broad catches, detached promises,
   unhandled-rejection/process-exit paths, suppressions, unused exports, TODO debt,
   boundary imports, and oversized modules. Scans produce leads, not findings.
4. Create module/finding directories from the templates; define write-lane and
   Critical second-pass owners.

**Exit:** denominator is frozen; baseline commands/results are linked; every unit
has a size, risk rank, owner or owner-needed marker, and report path.

### Wave 1 — Security and trust boundaries (18–30 reviewer-days)

Ordered independent units:

1. `packages/ax-code/src/auth` (L)
2. `packages/ax-code/src/account` (M)
3. `packages/ax-code/src/config` (L)
4. `packages/ax-code/src/hooks` (M)
5. `packages/ax-code/src/env` (S)
6. `packages/ax-code/src/plugin` (L)
7. `packages/ax-code/src/audit` (M)
8. `packages/ax-code/src/risk` (M)
9. `packages/ax-code/src/control-plane` (L)
10. `packages/ax-code/src/installation` (M)
11. `packages/ax-code/src/desktop` (S)
12. Desktop Electron security policies (L)
13. Desktop Electron IPC policy and handlers (L)
14. Desktop Electron preload bridge (M)
15. `desktop/packages/web/server/lib/security` (M)
16. `desktop/packages/web/server/lib/ui-auth` (M)

**Gate:** no accepted Critical trust-boundary finding remains exposed before Wave 2.

### Wave 2 — Session and runtime hot path (25–40 reviewer-days)

1. `packages/ax-code/src/session` (XL: split at least into prompt/processor,
   messages/parts, compaction, lifecycle/queue, and fork/revert children)
2. `packages/ax-code/src/runtime` (L)
3. `packages/ax-code/src/runtime/headless` (M)
4. `packages/ax-code/src/agent` (L)
5. `packages/ax-code/src/planner` (M)
6. `packages/ax-code/src/dispatch` (M)
7. `packages/ax-code/src/workflow` (L)
8. `packages/ax-code/src/context` (M)
9. `packages/ax-code/src/prompt-history` (S)
10. `packages/ax-code/src/memory` (M)
11. `packages/ax-code/src/replay` (M)
12. `packages/ax-code/src/snapshot` (M)
13. `packages/ax-code/src/bus` (M)

Focus: turn invariants, retries/backoff, cancellation, compaction, event ordering,
bounded long-session state, child work, recovery, and false-completion paths.

### Wave 3 — Tools, permission, and isolation (25–42 reviewer-days)

1. `packages/ax-code/src/permission` (L)
2. `packages/ax-code/src/isolation` (L)
3. `packages/ax-code/src/tool` (XL: split mutation, execution, network/browser,
   orchestration, and read-only tool families)
4. `packages/ax-code/src/shell` (L)
5. `packages/ax-code/src/pty` (L)
6. `packages/ax-code/src/file` (L)
7. `packages/ax-code/src/patch` (M)
8. `packages/ax-code/src/worktree` (M)
9. `packages/ax-code/src/command` (M)
10. `packages/ax-code/src/question` (M)
11. `packages/ax-code/src/bun` (S)
12. `packages/ax-code/src/native` (M)
13. `packages/ax-code/src/image` (M)
14. `packages/ax-code/src/import` (M)

Focus: repository trust, path/symlink semantics, protected paths, subprocess trees,
approval races, tool validation, network scope, resource cleanup, and native fallback.

### Wave 4 — Storage, server, and local control plane (20–35 reviewer-days)

1. `packages/ax-code/src/storage` (L)
2. `packages/ax-code/src/server` (L)
3. `packages/ax-code/src/server/routes` (XL: split by route family)
4. `packages/ax-code/src/project` (M)
5. `packages/ax-code/src/id` (S)
6. `packages/ax-code/src/global` (S)
7. `packages/ax-code/src/share` (M)
8. `packages/ax-code/src/stats` (M)
9. `packages/ax-code/src/telemetry` (M)
10. `packages/ax-code/src/notification` (M)
11. `packages/ax-code/src/sdk` (M)

Focus: migrations, transactions/atomic writes, auth/CORS/SSE ordering, listener
cleanup, schema validation, status/exit truthfulness, retention, and generated SDK drift.

### Wave 5 — Providers, MCP, LSP, and intelligence (28–45 reviewer-days)

1. `packages/ax-code/src/provider` (XL: split registry/routing, stream transforms,
   auth/capabilities, retry/error translation, and model data)
2. `packages/ax-code/src/provider/ax-engine` (L)
3. `packages/ax-code/src/provider/cli` (L)
4. `packages/ax-code/src/provider/xai` (M)
5. `packages/ax-code/src/mcp` (XL: split lifecycle/transport, OAuth/trust, tools,
   discovery/config, and disposal)
6. `packages/ax-code/src/lsp` (L)
7. `packages/ax-code/src/code-intelligence` (L)
8. `packages/ax-code/src/graph` (L)
9. `packages/ax-code/src/capability` (M)
10. `packages/ax-code/src/acp` (M)
11. `packages/ax-code/src/ide` (M)
12. `packages/ax-code/src/skill` (L)
13. `packages/ax-code/src/mode` (M)
14. `packages/ax-code/src/quality` (M)
15. `packages/ax-code/src/design-check` (M)
16. `packages/ax-code/src/debug-engine` (M)
17. `packages/ax-code/src/debug` (S)
18. `packages/ax-code/src/perf` (M)
19. `packages/ax-code/src/wiki` (M)

Focus: secret handling, subprocess/env isolation, transport and OAuth lifecycle,
stream semantics, cancellation, discovery side effects, cache invalidation, model
capability drift, indexing consistency, and server disposal.

### Wave 6 — CLI command and TUI surfaces (30–50 reviewer-days)

Audit the `packages/ax-code/src/cli` parent (L) first, then each `cli/cmd` unit in
this order. Most are S; `run`, `serve`, `tui`, `github-agent`, `storage`, `debug`,
and `workflow` are M–XL and must be split when they exceed the band.

1. `cli/cmd` command registry/compatibility shims
2. `cli/cmd/session`
3. `cli/cmd/run`
4. `cli/cmd/headless-run`
5. `cli/cmd/serve`
6. `cli/cmd/workspace-serve`
7. `cli/cmd/runtime`
8. `cli/cmd/tui`
9. `cli/cmd/mcp`
10. `cli/cmd/providers`
11. `cli/cmd/models`
12. `cli/cmd/skill`
13. `cli/cmd/workflow`
14. `cli/cmd/doctor`
15. `cli/cmd/github-agent`
16. `cli/cmd/storage`
17. `cli/cmd/debug`
18. `cli/cmd/release`
19. `cli/cmd/webui`
20. `cli/cmd/wiki`
21. `cli/cmd/pr`
22. `cli/cmd/export`
23. `cli/cmd/import`
24. `cli/cmd/upgrade`
25. `cli/cmd/account`
26. `cli/cmd/acp`
27. `cli/cmd/agent`
28. `cli/cmd/audit`
29. `cli/cmd/branch`
30. `cli/cmd/capability`
31. `cli/cmd/compare`
32. `cli/cmd/context`
33. `cli/cmd/db`
34. `cli/cmd/design-check`
35. `cli/cmd/dre-graph`
36. `cli/cmd/generate`
37. `cli/cmd/github`
38. `cli/cmd/graph`
39. `cli/cmd/index-graph`
40. `cli/cmd/init`
41. `cli/cmd/memory`
42. `cli/cmd/replay`
43. `cli/cmd/restart`
44. `cli/cmd/risk`
45. `cli/cmd/rollback`
46. `cli/cmd/stats`
47. `cli/cmd/trace`
48. `cli/cmd/uninstall`

Focus: argument validation, command/exit semantics, JSON versus human output,
signal teardown, source/bundled parity, TUI lifecycle and memory, and delegation to
domain modules rather than duplicated business logic.

### Wave 7 — Desktop Electron and web server (32–52 reviewer-days)

Security policies, IPC, preload, `security`, and `ui-auth` were audited in Wave 1.
Continue with these remaining independent units:

1. Electron shell/window lifecycle (L)
2. Electron server-process lifecycle (L)
3. Electron tray (S)
4. Electron updates (M)
5. `desktop/packages/web/server` composition (L)
6. `desktop/packages/web/server/lib/ax-code` (L)
7. `desktop/packages/web/server/lib/desktop` (M)
8. `desktop/packages/web/server/lib/event-stream` (L)
9. `desktop/packages/web/server/lib/fs` (M)
10. `desktop/packages/web/server/lib/git` (L)
11. `desktop/packages/web/server/lib/github` (L)
12. `desktop/packages/web/server/lib/magic-prompts` (S)
13. `desktop/packages/web/server/lib/notifications` (M)
14. `desktop/packages/web/server/lib/preview` (M)
15. `desktop/packages/web/server/lib/projects` (L)
16. `desktop/packages/web/server/lib/quota` (L)
17. `desktop/packages/web/server/lib/scheduled-tasks` (L)
18. `desktop/packages/web/server/lib/session-folders` (M)
19. `desktop/packages/web/server/lib/skills-catalog` (M)
20. `desktop/packages/web/server/lib/terminal` (L)
21. `desktop/packages/web/server/lib/text` (S)
22. `desktop/packages/web/src` browser entry/`RuntimeAPIs` (M)

Focus: main-process blocking, renderer privilege, process restart truthfulness,
loopback auth, path scope, event-stream reconnect/leaks, adapter duplication, and
the documented Desktop ownership/import rules.

### Wave 8 — Desktop UI (20–34 reviewer-days)

1. `desktop/packages/ui/src/api` (L)
2. `desktop/packages/ui/src/apps` (M)
3. `desktop/packages/ui/src/components` (XL: split by feature surface)
4. `desktop/packages/ui/src/contexts` (M)
5. `desktop/packages/ui/src/hooks` (L)
6. `desktop/packages/ui/src/lib` (L)
7. `desktop/packages/ui/src/stores` (L)
8. `desktop/packages/ui/src/sync` (L)
9. `desktop/packages/ui/src/types` (S)

Focus: stale or duplicated state, subscription cleanup, race-safe optimistic updates,
render cost, lazy loading, accessibility of failure states, typed API boundaries,
and no server/Electron ownership leakage.

### Wave 9 — Supporting packages, native crates, and Desktop docs (32–50 reviewer-days)

1. `packages/sdk/js` (L)
2. `packages/plugin` (M)
3. `packages/util` (M)
4. `packages/script` (L)
5. `packages/opentui-core` (L)
6. `packages/opentui-solid` (L)
7. `packages/opentui-spinner` (S)
8. `packages/ax-wiki` (L)
9. `packages/ax-code-index-core` (M)
10. `packages/ax-code-fs-native` (M)
11. `packages/ax-code-diff-native` (M)
12. `packages/ax-code-parser-native` (M)
13. `packages/ax-code-terminal-native` (M)
14. `packages/ax-code-daemon` (M)
15. `crates/ax-code-index` (L)
16. `crates/ax-code-fs` (L)
17. `crates/ax-code-diff` (L)
18. `crates/ax-code-parser` (L)
19. `crates/ax-code-terminal` (L)
20. `crates/ax-code-daemon` (L)
21. `crates/ax-code-bench` (S)
22. `desktop/packages/docs` (S, lower priority)

Focus: package contracts, build/release scripts, generated drift, ABI/input validation,
panic/unsafe boundaries, sync native work on the JS event loop, fallback equivalence,
resource ownership, platform behavior, and documentation accuracy.

### Wave 10 — Residual core and cross-repository hygiene sweep (10–18 reviewer-days)

Audit remaining independent core units first:

1. `packages/ax-code/src/constants` (S)
2. `packages/ax-code/src/flag` (S)
3. `packages/ax-code/src/format` (S)
4. `packages/ax-code/src/util` (L)
5. `packages/ax-code/src/visual` (M)

Then repeat repository-wide dead-code and hygiene scans against the frozen baseline:
unused exports/registrations, dead branches, stale flags, compatibility layers,
empty or overly broad catches, unobserved promises, TODO/FIXME/HACK debt, suppressions,
duplicate policy, docs/schema drift, oversized files, generated drift, and retired
native/package artifacts. Each hit is assigned to an already audited owner; affected
modules reopen until the finding is fixed or validly deferred.

**Program exit:** final scans are triaged, no Critical remains open, High findings are
closed or within approved time-bounded exception, and every unit is signed off.

---

## 11. Verification strategy and command matrix

Use the narrowest affected tests during development, then the package/wave gates.
Do **not** run `pnpm test` from the repository root; it intentionally fails.

### Core CLI/runtime

```bash
pnpm run typecheck
pnpm --dir packages/ax-code run typecheck
pnpm --dir packages/ax-code run test:unit
pnpm --dir packages/ax-code run test:deterministic
pnpm --dir packages/ax-code run test:e2e
pnpm --dir packages/ax-code run test:recovery
```

Target an exact core test file with the documented mechanism:

```bash
cd packages/ax-code
AX_TEST_FILES=test/<domain>/<file>.test.ts pnpm exec vitest run
```

`test:live` is used only when credentials and explicit provider-test scope exist;
results must not expose secrets.

### Desktop

```bash
pnpm run check:desktop-boundaries
pnpm run desktop:typecheck
pnpm run desktop:lint
pnpm run desktop:test
pnpm run desktop:build
```

Target exact Desktop tests with:

```bash
pnpm --dir desktop exec vitest run <file>
```

### SDK, scripts, native, and repository structure

```bash
pnpm --dir packages/sdk/js run build
pnpm --dir packages/sdk/js test
pnpm run test:scripts
pnpm build:native:debug
pnpm run check:structure
```

Use `pnpm build:native` for release-path verification after native changes. Rust
unit tests and focused benchmarks are added where applicable, but do not substitute
for wrapper/fallback parity tests. Server/OpenAPI changes must rebuild and inspect
SDK generated artifacts for drift.

Every module report records commands actually run, exit status, relevant output or
artifact link, skipped commands with reason, and the environment when results are
performance- or platform-sensitive.

---

## 12. Deliverables and records

Program records live under
[`../reports/planning/module-quality-audit/`](../reports/planning/module-quality-audit/):

| Deliverable | Purpose |
|-------------|---------|
| [README.md](../reports/planning/module-quality-audit/README.md) | Program workflow, record layout, and contributor entrypoint |
| [PHASES.md](../reports/planning/module-quality-audit/PHASES.md) | Ordered execution checklist and wave gates |
| [STATUS.md](../reports/planning/module-quality-audit/STATUS.md) | Live metrics, owners, module states, and report links |
| [templates/MODULE-AUDIT.md](../reports/planning/module-quality-audit/templates/MODULE-AUDIT.md) | Required per-module map, review, findings, and sign-off structure |
| [templates/FINDING.md](../reports/planning/module-quality-audit/templates/FINDING.md) | Required evidence, impact, fix, verification, and deferral record |

Expected runtime layout created as audits begin:

```text
module-quality-audit/
  modules/<module-slug>/MODULE-AUDIT.md
  modules/<module-slug>/findings/AUDIT-<module-slug>-NNN.md
```

Fixes and tests remain in their product packages. Planning records link commits/PRs
without copying source or test output wholesale.

---

## 13. Success metrics

Wave 0 records baselines and the final denominator. `STATUS.md` reports these at
least weekly and at every wave gate:

| Metric | Definition | Target |
|--------|------------|--------|
| Modules audited | Units that completed protocol steps 1–8 / frozen units | 100% |
| Modules signed off | Units meeting step 9 / frozen units | 100% at program exit |
| Critical/High open vs closed | Accepted findings by severity and state, including SLA age | 0 Critical open at gates; no overdue High at exit |
| Silent-catch reduction | Triaged empty/broad silent catches remaining versus frozen baseline; legitimate best-effort catches require comment/logging rationale | Material reduction; 100% of remaining hits classified |
| Unhandled-rejection reduction | Confirmed detached/unobserved rejection paths remaining versus baseline | 0 accepted Critical/High; downward trend overall |
| High-risk test coverage delta | Branch/behavior coverage or enumerated invariant-path coverage for Wave 1–5 and accepted high-risk findings | Positive delta for every repaired high-risk gap; no unexplained regression |
| Performance baselines | Before/after latency, throughput, CPU, memory/listener growth, IO count, or binary/startup measure for relevant modules | No accepted regression; each performance fix meets its finding threshold |
| Boundary health | `check:desktop-boundaries`, affected typechecks, and generated-drift checks | 100% green; no new boundary exceptions without rationale |
| Finding quality | Accepted findings with complete source, proof, impact, fix, and verification | 100% |
| Deferral health | Deferred findings with owner, rationale, mitigation, and review/expiry date | 100%; 0 expired unreviewed Critical/High exceptions |

Coverage percentage is not compared across unlike languages or test runners without
context. For modules where line coverage is misleading, enumerate risk-path tests
and explain the proxy in the report.

---

## 14. Program acceptance criteria

- [x] Wave 0 freezes the complete inventory, stable slugs, risk rank, owners, test
      locations, and baseline commit in `STATUS.md`.
- [x] Every CLI core module, nested provider/runtime/server unit, and logical
      `cli/cmd` unit in Section 5 has a completed report and sign-off.
- [x] Every supporting package/native wrapper/crate and Desktop unit in Section 5
      has a completed report and sign-off.
- [x] Every accepted finding satisfies the evidence standard and uses a stable ID
      and allowed category.
- [x] Every accepted correctness, security, stability, or silent-error fix has a
      regression test or a documented, approved reason why a deterministic test is
      infeasible plus alternate proof.
- [x] No Critical finding is open; all Critical findings and fixes were independently
      re-verified. No High finding is overdue or silently deferred.
- [x] Deferrals meet the severity policy and have owner, rationale, mitigation,
      review/expiry date, and ADR only when decision-level.
- [x] Affected package tests/typechecks and final core/Desktop/SDK/script/native/
      structure gates pass; `pnpm run check:desktop-boundaries` reports no regression.
- [x] Baseline and final silent-error, unhandled-rejection, coverage, performance,
      and open/closed severity metrics are published in `STATUS.md`.
- [x] The final hygiene sweep is fully triaged and any reopened module is re-signed.
- [x] Prior-review findings are linked with lineage and not counted as new discoveries.

---

## 15. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Review breadth produces shallow checkbox audits | Required map, failure model, evidence record, test map, and sign-off; XL units must split |
| Finding-count incentives create noise | No quotas; candidates do not count; impact and proof required |
| Parallel review duplicates or misses ownership | Frozen slugs, explicit assignments, one owning module, linked impacted modules |
| Review and fixes drift across a long program | Pin baseline SHA per report; refresh changed modules before sign-off; reopen on overlapping changes |
| Critical fixes create new risk under urgency | Human review, negative regression test, independent second pass, containment before redesign |
| Large refactors consume the program | Minimal-fix policy; evidence and ADR gate for decision-level changes |
| Static scans misclassify dynamic registrations/dead code | Trace build/runtime registration and platform paths; searches create candidates only |
| Full gates are slow or flaky | Narrow tests per fix, package gates per wave, quarantine/flake status recorded rather than hidden by reruns |
| Performance work optimizes synthetic cases | Representative workload, environment disclosure, repetitions/variance, before/after comparison |
| Planning records become stale | Status update is part of module exit and wave gate; weekly metrics cadence |

---

## 16. Related documents

- [2026-07-19 Code Quality & Stability Review](../reports/reviews/2026-07-19-code-quality-stability-review.md)
- [AX Code Architecture](../../packages/ax-code/ARCHITECTURE.md)
- [Desktop Project Boundaries](../../desktop/docs/PROJECT_BOUNDARIES.md)
- [Root contributor and verification conventions](../../AGENTS.md)
- [TUI Stability & Maintainability PRD](PRD-2026-07-10-tui-stability-maintainability.md)
- [Runtime Stability Hardening PRD](PRD-2026-07-14-runtime-stability-hardening.md)
- [Module Quality Audit planning hub](../reports/planning/module-quality-audit/README.md)
