> **PROGRAM COMPLETE (2026-08-11):** All waves GATE PASSED; frozen denominator 255 signed off. See STATUS.md.

# Implementation Phases: Module-by-Module Quality Audit

Companion to the
[PRD](../../../prd/PRD-2026-08-11-module-by-module-quality-audit.md),
[program README](./README.md), and [live status](./STATUS.md).

Legend: **NOT STARTED** · **IN PROGRESS** · **BLOCKED** · **GATE PASSED**

Effort is review/report time before fixes: **S** = 0.5–1 reviewer-day,
**M** = 1–2, **L** = 3–5, **XL** = split into named child reports before review.
The sequence inside each wave is intentional. Read-only work may overlap only after
prerequisites and ownership are clear; shared-file fixes remain serialized.

---

## Program rules

- [ ] Every unit uses `templates/MODULE-AUDIT.md` and every finding uses
      `templates/FINDING.md`.
- [ ] Every report pins a baseline commit and receives a delta review before sign-off.
- [ ] Search/static-analysis output is candidate input, never proof by itself.
- [ ] Tests land before or with accepted behavioral fixes.
- [ ] Critical findings and fixes receive an independent second pass.
- [ ] Prior-review findings retain lineage and are not counted as new discoveries.
- [ ] No module signs off with unresolved accepted findings except policy-compliant
      deferrals.
- [ ] `STATUS.md` is updated with every state transition and wave gate.

---

## Wave 0 — Inventory, tooling, and baseline

**Status:** NOT STARTED  
**Estimate:** 3–5 reviewer-days

### Ordered work

1. [ ] Record baseline commit and supported Node/pnpm/Rust/platform environment.
2. [ ] Reconcile every PRD audit unit with current source, tests, generated artifacts,
       native/fallback pair, public entrypoint, and owner.
3. [ ] Freeze stable slugs and classify parent versus leaf units. Split every XL unit
       into child rows; freeze the metrics denominator.
4. [ ] Build the dependency/risk map and assign Wave 1–3 reviewers plus independent
       Critical verifiers.
5. [ ] Capture module/file/LOC and test-file inventory, known quarantine/flakes, and
       test/coverage availability by package.
6. [ ] Run and record clean/failed baseline typecheck, boundary, SDK drift, script,
       structure, Desktop, and native build checks.
7. [ ] Capture representative performance baselines for startup, session turns,
       storage/server events, Desktop event streams/rendering, and native/fallback
       paths where a stable harness already exists.
8. [ ] Establish reproducible candidate scans for empty/broad catches, detached
       promises, process rejection/exit handling, unused exports, TODO debt,
       suppressions, boundary imports, large files, and generated drift.
9. [ ] Document scan commands/tool versions and triage rules in `STATUS.md`; do not
       convert raw counts directly into findings.
10. [ ] Confirm report paths, write-lane ownership, Critical escalation, weekly metric
        cadence, and reopening rules with maintainers.

### Baseline commands

```bash
pnpm run typecheck
pnpm --dir packages/ax-code run typecheck
pnpm --dir packages/ax-code run test:unit
pnpm --dir packages/ax-code run test:deterministic
pnpm run check:desktop-boundaries
pnpm run desktop:typecheck
pnpm run desktop:lint
pnpm run desktop:test
pnpm --dir packages/sdk/js run build
pnpm --dir packages/sdk/js test
pnpm run test:scripts
pnpm build:native:debug
pnpm run check:structure
```

### Gate

- [ ] Inventory denominator, slugs, size, risk, ownership, and report paths are frozen.
- [ ] Baseline failures are classified as pre-existing candidates or environment gaps.
- [ ] Metrics have values or an explicit `not measurable` rationale and proxy.
- [ ] Wave 1 units and independent verification coverage are assigned.

---

## Wave 1 — Security and trust boundaries

**Status:** NOT STARTED  
**Estimate:** 18–30 reviewer-days

### Ordered audit units

1. [ ] `packages/ax-code/src/auth` — L
2. [ ] `packages/ax-code/src/account` — M
3. [ ] `packages/ax-code/src/config` — L
4. [ ] `packages/ax-code/src/hooks` — M
5. [ ] `packages/ax-code/src/env` — S
6. [ ] `packages/ax-code/src/plugin` — L
7. [ ] `packages/ax-code/src/audit` — M
8. [ ] `packages/ax-code/src/risk` — M
9. [ ] `packages/ax-code/src/control-plane` — L
10. [ ] `packages/ax-code/src/installation` — M
11. [ ] `packages/ax-code/src/desktop` — S
12. [ ] Desktop Electron security policies — L
13. [ ] Desktop Electron IPC policy and handlers — L
14. [ ] Desktop Electron preload bridge — M
15. [ ] `desktop/packages/web/server/lib/security` — M
16. [ ] `desktop/packages/web/server/lib/ui-auth` — M

### Required focus

- untrusted checkout/config/hook/plugin execution and workspace trust;
- credentials, environment propagation, logs, IPC, preload capability, sender/origin,
  local HTTP auth, navigation/webview, updates, and installation artifacts;
- fail-open policy, validation, consent persistence, revocation, and degraded states;
- independent negative tests for accepted security findings.

### Gate

- [ ] Every Wave 1 unit is signed off.
- [ ] No accepted Critical trust-boundary finding remains exposed.
- [ ] Every Critical finding and containment/fix has independent verification.
- [ ] High exceptions, if any, are time-bounded and approved under the PRD rubric.

---

## Wave 2 — Session and runtime hot path

**Status:** NOT STARTED  
**Estimate:** 25–40 reviewer-days

### Ordered audit units

1. [ ] `packages/ax-code/src/session` — XL; split prompt/processor,
       messages/parts, compaction, lifecycle/queue, and fork/revert at minimum
2. [ ] `packages/ax-code/src/runtime` — L
3. [ ] `packages/ax-code/src/runtime/headless` — M
4. [ ] `packages/ax-code/src/agent` — L
5. [ ] `packages/ax-code/src/planner` — M
6. [ ] `packages/ax-code/src/dispatch` — M
7. [ ] `packages/ax-code/src/workflow` — L
8. [ ] `packages/ax-code/src/context` — M
9. [ ] `packages/ax-code/src/prompt-history` — S
10. [ ] `packages/ax-code/src/memory` — M
11. [ ] `packages/ax-code/src/replay` — M
12. [ ] `packages/ax-code/src/snapshot` — M
13. [ ] `packages/ax-code/src/bus` — M

### Required focus

- persisted-message/turn invariants, stream terminal states, retry classification,
  backoff, abort, cancellation, queue teardown, and user-visible error truth;
- compaction, replay, rollback, snapshots, child work, completion gates, and recovery;
- event ordering, listener/state growth, deadline behavior, and long-session baselines;
- focused unit plus deterministic/recovery/e2e tests for repaired paths.

### Gate

- [ ] Every leaf/parent Wave 2 report is signed off.
- [ ] No open Critical/High session data-loss, false-completion, or process-failure path.
- [ ] Long-session growth and relevant turn-latency baselines are recorded.
- [ ] Core typecheck and affected unit/deterministic/recovery/e2e tests pass.

---

## Wave 3 — Tools, permission, and isolation

**Status:** NOT STARTED  
**Estimate:** 25–42 reviewer-days

### Ordered audit units

1. [ ] `packages/ax-code/src/permission` — L
2. [ ] `packages/ax-code/src/isolation` — L
3. [ ] `packages/ax-code/src/tool` — XL; split mutation, execution,
       network/browser, orchestration, and read-only families
4. [ ] `packages/ax-code/src/shell` — L
5. [ ] `packages/ax-code/src/pty` — L
6. [ ] `packages/ax-code/src/file` — L
7. [ ] `packages/ax-code/src/patch` — M
8. [ ] `packages/ax-code/src/worktree` — M
9. [ ] `packages/ax-code/src/command` — M
10. [ ] `packages/ax-code/src/question` — M
11. [ ] `packages/ax-code/src/bun` — S
12. [ ] `packages/ax-code/src/native` — M
13. [ ] `packages/ax-code/src/image` — M
14. [ ] `packages/ax-code/src/import` — M

### Required focus

- permission composition and caching, path/symlink/variable expansion, protected and
  external paths, approval-time races, write conflicts, and blast radius;
- subprocess process groups, environment, output bounds, timeout/abort cleanup,
  PTY sockets, OS/app sandbox equivalence, and platform-specific behavior;
- tool input validation, network redirects/SSRF, model-controlled arguments, native
  fallback equivalence, and one shared error-visible resource lifecycle.

### Gate

- [ ] Every Wave 3 unit is signed off.
- [ ] No accepted Critical permission/isolation bypass remains exposed.
- [ ] Negative tests cover every repaired trust/permission boundary.
- [ ] Core typecheck and affected tool/e2e/native tests pass.

---

## Wave 4 — Storage, server, and local control plane

**Status:** NOT STARTED  
**Estimate:** 20–35 reviewer-days

### Ordered audit units

1. [ ] `packages/ax-code/src/storage` — L
2. [ ] `packages/ax-code/src/server` — L
3. [ ] `packages/ax-code/src/server/routes` — XL; split by route family
4. [ ] `packages/ax-code/src/project` — M
5. [ ] `packages/ax-code/src/id` — S
6. [ ] `packages/ax-code/src/global` — S
7. [ ] `packages/ax-code/src/share` — M
8. [ ] `packages/ax-code/src/stats` — M
9. [ ] `packages/ax-code/src/telemetry` — M
10. [ ] `packages/ax-code/src/notification` — M
11. [ ] `packages/ax-code/src/sdk` — M

### Required focus

- migration atomicity/recovery, corruption/isolation, transactions/locks, retention,
  dual persistence, partial writes, identifiers, and concurrent access;
- middleware/route order, auth/CORS, validation, SSE/listener cleanup, status/error
  semantics, local/remote exposure, telemetry privacy, and SDK contract drift;
- storage/recovery/server route tests and SDK rebuild after contract changes.

### Gate

- [ ] Every Wave 4 unit is signed off.
- [ ] Migration/recovery fixtures cover accepted storage defects.
- [ ] Server/OpenAPI changes rebuild cleanly with no generated SDK drift.
- [ ] Core typecheck and affected deterministic/recovery/e2e/SDK tests pass.

---

## Wave 5 — Providers, MCP, LSP, and intelligence

**Status:** NOT STARTED  
**Estimate:** 28–45 reviewer-days

### Ordered audit units

1. [ ] `packages/ax-code/src/provider` — XL; split registry/routing,
       stream transforms, auth/capabilities, retry/error translation, and model data
2. [ ] `packages/ax-code/src/provider/ax-engine` — L
3. [ ] `packages/ax-code/src/provider/cli` — L
4. [ ] `packages/ax-code/src/provider/xai` — M
5. [ ] `packages/ax-code/src/mcp` — XL; split lifecycle/transport, OAuth/trust,
       tools, discovery/config, and disposal
6. [ ] `packages/ax-code/src/lsp` — L
7. [ ] `packages/ax-code/src/code-intelligence` — L
8. [ ] `packages/ax-code/src/graph` — L
9. [ ] `packages/ax-code/src/capability` — M
10. [ ] `packages/ax-code/src/acp` — M
11. [ ] `packages/ax-code/src/ide` — M
12. [ ] `packages/ax-code/src/skill` — L
13. [ ] `packages/ax-code/src/mode` — M
14. [ ] `packages/ax-code/src/quality` — M
15. [ ] `packages/ax-code/src/design-check` — M
16. [ ] `packages/ax-code/src/debug-engine` — M
17. [ ] `packages/ax-code/src/debug` — S
18. [ ] `packages/ax-code/src/perf` — M
19. [ ] `packages/ax-code/src/wiki` — M

### Required focus

- credential/env/log redaction, provider stream and retry contracts, cancellation,
  model/capability data validation, CLI child lifecycle, and sidecar isolation;
- MCP transport/OAuth/trust/discovery/cache/disposal; LSP spawn/dispose and process
  registry; graph/index consistency, cache invalidation, native fallback, and load;
- provider live tests only with explicit credentials/scope and sanitized records.

### Gate

- [ ] Every Wave 5 unit is signed off.
- [ ] No Critical/High secret exposure, child-process leak, or transport lifecycle defect remains.
- [ ] Capability/model/generated-data drift checks are green.
- [ ] Core typecheck and affected unit/deterministic/e2e/live/native tests pass.

---

## Wave 6 — CLI command and TUI surfaces

**Status:** NOT STARTED  
**Estimate:** 30–50 reviewer-days

Audit `packages/ax-code/src/cli` (L) before its commands. Most commands are S;
split `run`, `serve`, `tui`, `github-agent`, `storage`, `debug`, and `workflow` when
Wave 0 sizing finds they are L/XL.

### Ordered command units

1. [ ] `cli/cmd` command registry and compatibility shims
2. [ ] `cli/cmd/session`
3. [ ] `cli/cmd/run`
4. [ ] `cli/cmd/headless-run`
5. [ ] `cli/cmd/serve`
6. [ ] `cli/cmd/workspace-serve`
7. [ ] `cli/cmd/runtime`
8. [ ] `cli/cmd/tui`
9. [ ] `cli/cmd/mcp`
10. [ ] `cli/cmd/providers`
11. [ ] `cli/cmd/models`
12. [ ] `cli/cmd/skill`
13. [ ] `cli/cmd/workflow`
14. [ ] `cli/cmd/doctor`
15. [ ] `cli/cmd/github-agent`
16. [ ] `cli/cmd/storage`
17. [ ] `cli/cmd/debug`
18. [ ] `cli/cmd/release`
19. [ ] `cli/cmd/webui`
20. [ ] `cli/cmd/wiki`
21. [ ] `cli/cmd/pr`
22. [ ] `cli/cmd/export`
23. [ ] `cli/cmd/import`
24. [ ] `cli/cmd/upgrade`
25. [ ] `cli/cmd/account`
26. [ ] `cli/cmd/acp`
27. [ ] `cli/cmd/agent`
28. [ ] `cli/cmd/audit`
29. [ ] `cli/cmd/branch`
30. [ ] `cli/cmd/capability`
31. [ ] `cli/cmd/compare`
32. [ ] `cli/cmd/context`
33. [ ] `cli/cmd/db`
34. [ ] `cli/cmd/design-check`
35. [ ] `cli/cmd/dre-graph`
36. [ ] `cli/cmd/generate`
37. [ ] `cli/cmd/github`
38. [ ] `cli/cmd/graph`
39. [ ] `cli/cmd/index-graph`
40. [ ] `cli/cmd/init`
41. [ ] `cli/cmd/memory`
42. [ ] `cli/cmd/replay`
43. [ ] `cli/cmd/restart`
44. [ ] `cli/cmd/risk`
45. [ ] `cli/cmd/rollback`
46. [ ] `cli/cmd/stats`
47. [ ] `cli/cmd/trace`
48. [ ] `cli/cmd/uninstall`

### Required focus

- boundary validation, domain delegation, human/JSON output, correct exit/status,
  signal/process teardown, source/bundled parity, destructive-command consent;
- TUI lifecycle, subscriptions, session/workspace scoping, long-session retention,
  accessibility/readability of failures, and OpenTUI/native integration.

### Gate

- [ ] CLI parent and every command unit are signed off.
- [ ] Source and bundled CLI command/exit contracts match for repaired paths.
- [ ] Core typecheck, targeted tests, deterministic/e2e/recovery, and TUI smoke gates pass.

---

## Wave 7 — Desktop Electron and web server

**Status:** NOT STARTED  
**Estimate:** 32–52 reviewer-days

Wave 1 already owns Electron security policy, IPC, preload, web `security`, and
`ui-auth`. Do not duplicate them; re-open/link them if later findings cross boundaries.

### Ordered audit units

1. [ ] Electron shell/window lifecycle — L
2. [ ] Electron server-process lifecycle — L
3. [ ] Electron tray — S
4. [ ] Electron updates — M
5. [ ] `desktop/packages/web/server` composition — L
6. [ ] `desktop/packages/web/server/lib/ax-code` — L
7. [ ] `desktop/packages/web/server/lib/desktop` — M
8. [ ] `desktop/packages/web/server/lib/event-stream` — L
9. [ ] `desktop/packages/web/server/lib/fs` — M
10. [ ] `desktop/packages/web/server/lib/git` — L
11. [ ] `desktop/packages/web/server/lib/github` — L
12. [ ] `desktop/packages/web/server/lib/magic-prompts` — S
13. [ ] `desktop/packages/web/server/lib/notifications` — M
14. [ ] `desktop/packages/web/server/lib/preview` — M
15. [ ] `desktop/packages/web/server/lib/projects` — L
16. [ ] `desktop/packages/web/server/lib/quota` — L
17. [ ] `desktop/packages/web/server/lib/scheduled-tasks` — L
18. [ ] `desktop/packages/web/server/lib/session-folders` — M
19. [ ] `desktop/packages/web/server/lib/skills-catalog` — M
20. [ ] `desktop/packages/web/server/lib/terminal` — L
21. [ ] `desktop/packages/web/server/lib/text` — S
22. [ ] `desktop/packages/web/src` browser entry and `RuntimeAPIs` — M

### Required focus

- Electron main-process responsiveness, window/quit/restart/crash behavior, updates,
  tray lifecycle, process status/exit truth, and renderer-visible degraded states;
- loopback server auth, path/project scope, git/GitHub credentials, terminal processes,
  event-stream reconnect/listener growth, scheduled task claims, preview proxying;
- no duplicated AX Code runtime semantics or forbidden cross-package imports.

### Gate

- [ ] Every Wave 7 unit is signed off.
- [ ] `pnpm run check:desktop-boundaries` passes with no unexplained exception.
- [ ] Desktop typecheck, lint, test, and build pass.
- [ ] Process restart and event-stream recovery tests cover accepted defects.

---

## Wave 8 — Desktop UI

**Status:** NOT STARTED  
**Estimate:** 20–34 reviewer-days

### Ordered audit units

1. [ ] `desktop/packages/ui/src/api` — L
2. [ ] `desktop/packages/ui/src/apps` — M
3. [ ] `desktop/packages/ui/src/components` — XL; split by feature surface
4. [ ] `desktop/packages/ui/src/contexts` — M
5. [ ] `desktop/packages/ui/src/hooks` — L
6. [ ] `desktop/packages/ui/src/lib` — L
7. [ ] `desktop/packages/ui/src/stores` — L
8. [ ] `desktop/packages/ui/src/sync` — L
9. [ ] `desktop/packages/ui/src/types` — S

### Required focus

- typed API contracts, stale/duplicated state, optimistic update rollback, event order,
  subscription/timer cleanup, unmounted updates, and failure/degraded-state UX;
- render frequency, selectors, large lists/transcripts, bundle/lazy-loading, and no
  Electron/server/runtime ownership leakage into UI code.

### Gate

- [ ] Every Wave 8 unit and required component child is signed off.
- [ ] UI typecheck/lint/tests/build and Desktop boundary check pass.
- [ ] Relevant render/memory baselines show no accepted regression.

---

## Wave 9 — Supporting packages, native crates, and Desktop docs

**Status:** NOT STARTED  
**Estimate:** 32–50 reviewer-days

### Ordered audit units

1. [ ] `packages/sdk/js` — L
2. [ ] `packages/plugin` — M
3. [ ] `packages/util` — M
4. [ ] `packages/script` — L
5. [ ] `packages/opentui-core` — L
6. [ ] `packages/opentui-solid` — L
7. [ ] `packages/opentui-spinner` — S
8. [ ] `packages/ax-wiki` — L
9. [ ] `packages/ax-code-index-core` — M
10. [ ] `packages/ax-code-fs-native` — M
11. [ ] `packages/ax-code-diff-native` — M
12. [ ] `packages/ax-code-parser-native` — M
13. [ ] `packages/ax-code-terminal-native` — M
14. [ ] `packages/ax-code-daemon` — M
15. [ ] `crates/ax-code-index` — L
16. [ ] `crates/ax-code-fs` — L
17. [ ] `crates/ax-code-diff` — L
18. [ ] `crates/ax-code-parser` — L
19. [ ] `crates/ax-code-terminal` — L
20. [ ] `crates/ax-code-daemon` — L
21. [ ] `crates/ax-code-bench` — S
22. [ ] `desktop/packages/docs` — S, lower priority

### Required focus

- package exports/contracts, dependency ownership, build/release scripts, generated
  provenance/drift, OpenTUI lifecycle, documentation/build accuracy;
- N-API/FFI validation, panics/unsafe, blocking work, locks/processes, bounded inputs,
  ABI/platform packaging, native/fallback error and result equivalence.

### Gate

- [ ] Every Wave 9 unit is signed off.
- [ ] SDK build/test, script tests, debug and release native builds as affected pass.
- [ ] Wrapper/fallback parity and relevant Rust tests/benchmarks pass.
- [ ] Retired or broken artifacts have an evidence-backed disposition.

---

## Wave 10 — Residual core and final hygiene sweep

**Status:** NOT STARTED  
**Estimate:** 10–18 reviewer-days

### Ordered residual units

1. [ ] `packages/ax-code/src/constants` — S
2. [ ] `packages/ax-code/src/flag` — S
3. [ ] `packages/ax-code/src/format` — S
4. [ ] `packages/ax-code/src/util` — L
5. [ ] `packages/ax-code/src/visual` — M

### Repository-wide sweep

1. [ ] Re-run the frozen unused-export/registration/dead-branch scan.
2. [ ] Re-run empty/broad-catch, detached-promise, unhandled-rejection, and exit-code scans.
3. [ ] Re-run TODO/FIXME/HACK, suppression/cast, duplicate-policy, and god-file scans.
4. [ ] Re-run boundary, generated-drift, retired-artifact, schema/docs/config, and
       native-wrapper inventory checks.
5. [ ] Assign every hit to one owning module and evidence-backed disposition.
6. [ ] Reopen affected modules, repair/defer findings, run delta review, and re-sign.
7. [ ] Publish final baselines/deltas, open/closed severity counts, SLA/deferral health,
       and all required command results in `STATUS.md`.

### Final verification

```bash
pnpm --dir packages/sdk/js run build
pnpm --dir packages/sdk/js test
pnpm run test:scripts
pnpm run typecheck
pnpm --dir packages/ax-code run typecheck
pnpm --dir packages/ax-code run test:ci -- --deterministic
pnpm run check:desktop-boundaries
pnpm run desktop:typecheck
pnpm run desktop:lint
pnpm run desktop:test
pnpm run desktop:build
pnpm run check:structure
```

Run `pnpm build:native` when the program changed native code or packaging.

### Program gate

- [ ] 100% of frozen units audited and signed off.
- [ ] 0 open Critical findings; 100% independently verified.
- [ ] 0 overdue High findings or expired Critical/High exceptions.
- [ ] Every accepted finding has complete evidence and verified fix/valid deferral.
- [ ] Silent-error and unhandled-rejection scans are fully classified with final deltas.
- [ ] High-risk test/coverage and relevant performance deltas are published.
- [ ] Core, Desktop, SDK, scripts, native-as-affected, structure, and boundary gates pass.
- [ ] Prior-art lineage and duplicate counts are correct.
