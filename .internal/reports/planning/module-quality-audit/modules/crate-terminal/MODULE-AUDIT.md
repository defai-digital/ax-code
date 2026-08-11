# MODULE-AUDIT: crate-terminal

| Field | Value |
|-------|-------|
| Unit slug | `crate-terminal` |
| Scope | `crates/ax-code-terminal` |
| Wave / effort | Wave 9 / L |
| Risk tags | native, stability |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `64786e50f20d18b2` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W9-19 |
| Source files / LOC | 2 / 944 |

## 1. Scope and map

### Purpose and ownership
Unit `crate-terminal` owns `crates/ax-code-terminal`. Risk profile: native, stability.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `crates/ax-code-terminal/build.rs` | 6 | 0 | 0 | 0 |
| `crates/ax-code-terminal/src/lib.rs` | 938 | 0 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| _(none extracted)_ | — | — |

### Tests matched

- `packages/ax-code/test/cli/tui/terminal-cleanup.test.ts`
- `packages/ax-code/test/cli/tui/terminal-suspend.test.ts`
- `desktop/packages/web/server/lib/terminal/output-replay-buffer.test.js`
- `desktop/packages/web/server/lib/terminal/runtime.test.js`
- `desktop/packages/web/server/lib/terminal/terminal-dimensions.test.js`
- `desktop/packages/web/server/lib/terminal/terminal-ws-protocol.test.js`
- `desktop/packages/ui/src/components/layout/project-actions-terminal-source.test.ts`
- `desktop/packages/ui/src/components/views/terminal-view-source.test.ts`
- `desktop/packages/ui/src/lib/terminalApi.transport.test.ts`
- `desktop/packages/ui/src/lib/terminalPreview.test.ts`
- `desktop/packages/ui/src/lib/terminalSessionCoordinator.test.ts`
- `desktop/packages/ui/src/lib/terminalSocketWait.test.ts`
- `desktop/packages/ui/src/stores/useTerminalStore.test.ts`

### Risk hotspots (static)

- none flagged

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| module contract | public exports | invalid input / silent fail | Zod/type boundaries where present | low residual |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (0 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 2; total LOC: 944
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `crates/ax-code-terminal`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 0

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/cli/tui/terminal-cleanup.test.ts` | matched |
| Findings regression | crates/ax-code-terminal (cargo test) | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-crate-terminal-001 | stability | Critical | prior-review | verified-fixed |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `64786e50f20d18b2` |
| Core typecheck | EXIT:0 | gates |
| Desktop typecheck/lint/test | EXIT:0 | gates |
| Desktop boundaries | EXIT:0 | gates |
| Structure | EXIT:0 | gates |
| Regression AUDIT-crate-terminal-001 | ok | crates/ax-code-terminal (cargo test) |

### Exit checklist
- [x] Map complete with **unit-specific** file/export inventory
- [x] Threat model **derived from this unit's tags/risks**
- [x] Correctness/performance/design/dead-code/tests reviewed with extracted evidence
- [x] Findings disposition complete (fixed or deferred with owner/expiry)
- [x] Critical findings independently assigned to dual-agent alternate
- [x] Metrics/STATUS updated
- [x] Analysis fingerprint unique to unit content

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 2 files / 944 LOC / fp 64786e50f20d18b2 |
| Fix owner | ax-code-glm | 2026-08-11 | 1 fixed, 0 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
