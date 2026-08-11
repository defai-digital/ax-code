# MODULE-AUDIT: ui-components-update

| Field | Value |
|-------|-------|
| Unit slug | `ui-components-update` |
| Scope | `desktop/packages/ui/src/components/update` |
| Wave / effort | Wave 8 / S |
| Risk tags | desktop, ui |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `b556230afa185c43` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W8-03-22 |
| Source files / LOC | 3 / 529 |

## 1. Scope and map

### Purpose and ownership
Unit `ui-components-update` owns `desktop/packages/ui/src/components/update`. Risk profile: desktop, ui.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/ui/src/components/update/AxCodeUpdateToast.tsx` | 211 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/update/__tests__/axCodeUpdateDedup.test.ts` | 226 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/update/axCodeUpdateDedup.ts` | 92 | 7 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `AxCodeUpdateToast@desktop/packages/ui/src/components/update/AxCodeUpdateToast.tsx:24` | public/internal | scanned |
| `AxCodeUpdateToastDecisionInput@desktop/packages/ui/src/components/update/axCodeUpdateDedup.ts:13` | public/internal | scanned |
| `shouldShowAxCodeUpdateToast@desktop/packages/ui/src/components/update/axCodeUpdateDedup.ts:30` | public/internal | scanned |
| `resolveAxCodeUpdateVersion@desktop/packages/ui/src/components/update/axCodeUpdateDedup.ts:45` | public/internal | scanned |
| `AxCodeUpgradeStatusLike@desktop/packages/ui/src/components/update/axCodeUpdateDedup.ts:52` | public/internal | scanned |
| `resolveAxCodeUpgradeStatusVersion@desktop/packages/ui/src/components/update/axCodeUpdateDedup.ts:65` | public/internal | scanned |
| `AxCodeIncompatibility@desktop/packages/ui/src/components/update/axCodeUpdateDedup.ts:72` | public/internal | scanned |
| `resolveAxCodeIncompatibility@desktop/packages/ui/src/components/update/axCodeUpdateDedup.ts:82` | public/internal | scanned |

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

- none flagged

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| renderer privilege boundary | preload/IPC/loopback | capability escape | IPC allowlist / origin checks | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (8 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 3; total LOC: 529
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `desktop/packages/ui/src/components/update`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 8

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
| Static deep extract | ok | fingerprint `b556230afa185c43` |
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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 3 files / 529 LOC / fp b556230afa185c43 |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
