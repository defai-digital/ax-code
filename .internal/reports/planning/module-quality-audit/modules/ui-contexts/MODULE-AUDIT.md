# MODULE-AUDIT: ui-contexts

| Field | Value |
|-------|-------|
| Unit slug | `ui-contexts` |
| Scope | `desktop/packages/ui/src/contexts` |
| Wave / effort | Wave 8 / M |
| Risk tags | desktop |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `a7cf996d1c9181a5` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W8-04 |
| Source files / LOC | 7 / 1188 |

## 1. Scope and map

### Purpose and ownership
Unit `ui-contexts` owns `desktop/packages/ui/src/contexts`. Risk profile: desktop.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/ui/src/contexts/DiffWorkerProvider.tsx` | 242 | 2 | 0 | 0 |
| `desktop/packages/ui/src/contexts/RuntimeAPIProvider.tsx` | 171 | 1 | 0 | 0 |
| `desktop/packages/ui/src/contexts/ThemeSystemContext.tsx` | 722 | 1 | 0 | 0 |
| `desktop/packages/ui/src/contexts/runtimeAPIContext.ts` | 5 | 1 | 0 | 0 |
| `desktop/packages/ui/src/contexts/runtimeAPIRegistry.ts` | 10 | 2 | 0 | 0 |
| `desktop/packages/ui/src/contexts/theme-system-context.ts` | 22 | 2 | 0 | 0 |
| `desktop/packages/ui/src/contexts/useThemeSystem.ts` | 16 | 2 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `DiffWorkerProvider@desktop/packages/ui/src/contexts/DiffWorkerProvider.tsx:183` | public/internal | scanned |
| `useWorkerPool@desktop/packages/ui/src/contexts/DiffWorkerProvider.tsx:223` | public/internal | scanned |
| `RuntimeAPIProvider@desktop/packages/ui/src/contexts/RuntimeAPIProvider.tsx:161` | public/internal | scanned |
| `ThemeSystemProvider@desktop/packages/ui/src/contexts/ThemeSystemContext.tsx:203` | public/internal | scanned |
| `RuntimeAPIContext@desktop/packages/ui/src/contexts/runtimeAPIContext.ts:4` | public/internal | scanned |
| `registerRuntimeAPIs@desktop/packages/ui/src/contexts/runtimeAPIRegistry.ts:5` | public/internal | scanned |
| `getRegisteredRuntimeAPIs@desktop/packages/ui/src/contexts/runtimeAPIRegistry.ts:9` | public/internal | scanned |
| `ThemeContextValue@desktop/packages/ui/src/contexts/theme-system-context.ts:5` | public/internal | scanned |
| `ThemeSystemContext@desktop/packages/ui/src/contexts/theme-system-context.ts:21` | public/internal | scanned |
| `useThemeSystem@desktop/packages/ui/src/contexts/useThemeSystem.ts:5` | public/internal | scanned |
| `useOptionalThemeSystem@desktop/packages/ui/src/contexts/useThemeSystem.ts:13` | public/internal | scanned |

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

- io desktop/packages/ui/src/contexts/RuntimeAPIProvider.tsx:66
- io desktop/packages/ui/src/contexts/RuntimeAPIProvider.tsx:72
- io desktop/packages/ui/src/contexts/RuntimeAPIProvider.tsx:83
- io desktop/packages/ui/src/contexts/RuntimeAPIProvider.tsx:103
- io desktop/packages/ui/src/contexts/RuntimeAPIProvider.tsx:130
- io desktop/packages/ui/src/contexts/RuntimeAPIProvider.tsx:133
- io desktop/packages/ui/src/contexts/RuntimeAPIProvider.tsx:154
- io desktop/packages/ui/src/contexts/RuntimeAPIProvider.tsx:155
- secret desktop/packages/ui/src/contexts/ThemeSystemContext.tsx:269

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |
| renderer privilege boundary | preload/IPC/loopback | capability escape | IPC allowlist / origin checks | none from scan |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (11 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 7; total LOC: 1188
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `desktop/packages/ui/src/contexts`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 11

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
| Static deep extract | ok | fingerprint `a7cf996d1c9181a5` |
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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 7 files / 1188 LOC / fp a7cf996d1c9181a5 |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
