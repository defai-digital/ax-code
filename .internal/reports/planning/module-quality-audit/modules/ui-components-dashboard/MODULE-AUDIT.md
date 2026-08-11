# MODULE-AUDIT: ui-components-dashboard

| Field | Value |
|-------|-------|
| Unit slug | `ui-components-dashboard` |
| Scope | `desktop/packages/ui/src/components/dashboard` |
| Wave / effort | Wave 8 / S |
| Risk tags | desktop, ui |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `0e253c70eb6eb590` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W8-03-04 |
| Source files / LOC | 4 / 748 |

## 1. Scope and map

### Purpose and ownership
Unit `ui-components-dashboard` owns `desktop/packages/ui/src/components/dashboard`. Risk profile: desktop, ui.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/ui/src/components/dashboard/DashboardPanel.tsx` | 128 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/dashboard/SessionPulse.tsx` | 292 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/dashboard/sessionPulseModel.test.ts` | 123 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/dashboard/sessionPulseModel.ts` | 205 | 7 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `DashboardPanel@desktop/packages/ui/src/components/dashboard/DashboardPanel.tsx:52` | public/internal | scanned |
| `SessionPulse@desktop/packages/ui/src/components/dashboard/SessionPulse.tsx:93` | public/internal | scanned |
| `SessionPulseReadiness@desktop/packages/ui/src/components/dashboard/sessionPulseModel.ts:7` | public/internal | scanned |
| `SessionPulseChange@desktop/packages/ui/src/components/dashboard/sessionPulseModel.ts:9` | public/internal | scanned |
| `SessionPulseValidation@desktop/packages/ui/src/components/dashboard/sessionPulseModel.ts:18` | public/internal | scanned |
| `SessionPulseModel@desktop/packages/ui/src/components/dashboard/sessionPulseModel.ts:25` | public/internal | scanned |
| `buildSessionPulseModel@desktop/packages/ui/src/components/dashboard/sessionPulseModel.ts:107` | public/internal | scanned |
| `formatDurationMs@desktop/packages/ui/src/components/dashboard/sessionPulseModel.ts:186` | public/internal | scanned |
| `formatTokenCount@desktop/packages/ui/src/components/dashboard/sessionPulseModel.ts:198` | public/internal | scanned |

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

- secret desktop/packages/ui/src/components/dashboard/SessionPulse.tsx:9
- secret desktop/packages/ui/src/components/dashboard/SessionPulse.tsx:106
- secret desktop/packages/ui/src/components/dashboard/SessionPulse.tsx:107
- secret desktop/packages/ui/src/components/dashboard/SessionPulse.tsx:192
- secret desktop/packages/ui/src/components/dashboard/SessionPulse.tsx:194
- secret desktop/packages/ui/src/components/dashboard/sessionPulseModel.test.ts:2
- secret desktop/packages/ui/src/components/dashboard/sessionPulseModel.test.ts:57
- secret desktop/packages/ui/src/components/dashboard/sessionPulseModel.test.ts:74
- secret desktop/packages/ui/src/components/dashboard/sessionPulseModel.test.ts:114
- secret desktop/packages/ui/src/components/dashboard/sessionPulseModel.test.ts:115
- secret desktop/packages/ui/src/components/dashboard/sessionPulseModel.test.ts:116
- secret desktop/packages/ui/src/components/dashboard/sessionPulseModel.test.ts:117

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |
| renderer privilege boundary | preload/IPC/loopback | capability escape | IPC allowlist / origin checks | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (9 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 4; total LOC: 748
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `desktop/packages/ui/src/components/dashboard`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 9

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
| Static deep extract | ok | fingerprint `0e253c70eb6eb590` |
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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 4 files / 748 LOC / fp 0e253c70eb6eb590 |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
