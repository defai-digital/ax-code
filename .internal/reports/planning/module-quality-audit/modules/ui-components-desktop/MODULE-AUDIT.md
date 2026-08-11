# MODULE-AUDIT: ui-components-desktop

| Field | Value |
|-------|-------|
| Unit slug | `ui-components-desktop` |
| Scope | `desktop/packages/ui/src/components/desktop` |
| Wave / effort | Wave 8 / S |
| Risk tags | desktop, ui |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `edb4b42999cc89ce` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W8-03-05 |
| Source files / LOC | 2 / 1647 |

## 1. Scope and map

### Purpose and ownership
Unit `ui-components-desktop` owns `desktop/packages/ui/src/components/desktop`. Risk profile: desktop, ui.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/ui/src/components/desktop/DesktopHostSwitcher.tsx` | 1448 | 3 | 0 | 0 |
| `desktop/packages/ui/src/components/desktop/OpenInAppButton.tsx` | 199 | 1 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `DesktopHostSwitcherDialog@desktop/packages/ui/src/components/desktop/DesktopHostSwitcher.tsx:248` | public/internal | scanned |
| `DesktopHostSwitcherButton@desktop/packages/ui/src/components/desktop/DesktopHostSwitcher.tsx:1186` | public/internal | scanned |
| `DesktopHostSwitcherInline@desktop/packages/ui/src/components/desktop/DesktopHostSwitcher.tsx:1423` | public/internal | scanned |
| `OpenInAppButton@desktop/packages/ui/src/components/desktop/OpenInAppButton.tsx:72` | public/internal | scanned |

### Tests matched

- `packages/ax-code/test/account/repo.test.ts`
- `packages/ax-code/test/account/service.test.ts`
- `packages/ax-code/test/account/token-decode.test.ts`
- `packages/ax-code/test/acp/agent-adapter.test.ts`
- `packages/ax-code/test/acp/agent-interface.test.ts`
- `packages/ax-code/test/acp/agent-prompt.test.ts`
- `packages/ax-code/test/acp/event-subscription.test.ts`
- `packages/ax-code/test/acp/sdk-client-naming.test.ts`
- `packages/ax-code/test/acp/session-list.test.ts`
- `packages/ax-code/test/acp/todo-plan-entries.test.ts`
- `packages/ax-code/test/agent/agent.test.ts`
- `packages/ax-code/test/agent/router.test.ts`
- `packages/ax-code/test/audit/bugfix.test.ts`
- `packages/ax-code/test/audit/json.test.ts`
- `packages/ax-code/test/audit/report.test.ts`
- `packages/ax-code/test/audit/semantic-call.test.ts`
- `packages/ax-code/test/audit/siem.test.ts`
- `packages/ax-code/test/auth/auth.test.ts`
- `packages/ax-code/test/auth/encryption.test.ts`
- `packages/ax-code/test/bug-reports/lifecycle-visibility.test.ts`

### Risk hotspots (static)

- secret desktop/packages/ui/src/components/desktop/DesktopHostSwitcher.tsx:291
- secret desktop/packages/ui/src/components/desktop/DesktopHostSwitcher.tsx:461
- secret desktop/packages/ui/src/components/desktop/DesktopHostSwitcher.tsx:462
- secret desktop/packages/ui/src/components/desktop/DesktopHostSwitcher.tsx:473
- secret desktop/packages/ui/src/components/desktop/DesktopHostSwitcher.tsx:491
- secret desktop/packages/ui/src/components/desktop/DesktopHostSwitcher.tsx:494
- secret desktop/packages/ui/src/components/desktop/DesktopHostSwitcher.tsx:504
- secret desktop/packages/ui/src/components/desktop/DesktopHostSwitcher.tsx:522
- secret desktop/packages/ui/src/components/desktop/DesktopHostSwitcher.tsx:644
- secret desktop/packages/ui/src/components/desktop/DesktopHostSwitcher.tsx:661

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |
| renderer privilege boundary | preload/IPC/loopback | capability escape | IPC allowlist / origin checks | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (4 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 2; total LOC: 1647
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `desktop/packages/ui/src/components/desktop`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 4

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/account/repo.test.ts` | matched |
| Findings regression | n/a | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `edb4b42999cc89ce` |
| Core typecheck | EXIT:0 | gates |
| Desktop typecheck/lint/test | EXIT:0 | gates |
| Desktop boundaries | EXIT:0 | gates |
| Structure | EXIT:0 | gates |


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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 2 files / 1647 LOC / fp edb4b42999cc89ce |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
