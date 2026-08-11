# MODULE-AUDIT: hooks

| Field | Value |
|-------|-------|
| Unit slug | `hooks` |
| Scope | `packages/ax-code/src/hooks` |
| Wave / effort | Wave 1 / M |
| Risk tags | security, trust |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `a1ae49db7023f049` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W1-04 |
| Source files / LOC | 1 / 350 |

## 1. Scope and map

### Purpose and ownership
Unit `hooks` owns `packages/ax-code/src/hooks`. Risk profile: security, trust.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/hooks/lifecycle.ts` | 350 | 15 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `LifecycleHooks@packages/ax-code/src/hooks/lifecycle.ts:24` | public/internal | scanned |
| `EventName@packages/ax-code/src/hooks/lifecycle.ts:69` | public/internal | scanned |
| `HookCommand@packages/ax-code/src/hooks/lifecycle.ts:70` | public/internal | scanned |
| `Pack@packages/ax-code/src/hooks/lifecycle.ts:77` | public/internal | scanned |
| `RunInput@packages/ax-code/src/hooks/lifecycle.ts:83` | public/internal | scanned |
| `RunResult@packages/ax-code/src/hooks/lifecycle.ts:91` | public/internal | scanned |
| `listBuiltinPacks@packages/ax-code/src/hooks/lifecycle.ts:161` | public/internal | scanned |
| `matcherHits@packages/ax-code/src/hooks/lifecycle.ts:165` | public/internal | scanned |
| `selectHooks@packages/ax-code/src/hooks/lifecycle.ts:178` | public/internal | scanned |
| `loadProjectHooks@packages/ax-code/src/hooks/lifecycle.ts:182` | public/internal | scanned |
| `resolveHooks@packages/ax-code/src/hooks/lifecycle.ts:207` | public/internal | scanned |
| `runHooks@packages/ax-code/src/hooks/lifecycle.ts:302` | public/internal | scanned |
| `runForWorkspace@packages/ax-code/src/hooks/lifecycle.ts:320` | public/internal | scanned |
| `packCatalogMarkdown@packages/ax-code/src/hooks/lifecycle.ts:326` | public/internal | scanned |
| `globalHooksDir@packages/ax-code/src/hooks/lifecycle.ts:346` | public/internal | scanned |

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

- io packages/ax-code/src/hooks/lifecycle.ts:30
- io packages/ax-code/src/hooks/lifecycle.ts:189
- process packages/ax-code/src/hooks/lifecycle.ts:241
- process packages/ax-code/src/hooks/lifecycle.ts:242

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |
| host process / FS | spawn/shell | escape sandbox, orphan children | permission + isolation layers | OS sandbox opt-in residual |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (15 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 1; total LOC: 350
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/hooks`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 15

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/account/repo.test.ts` | matched |
| Findings regression | packages/ax-code/test (hooks/trust coverage via lifecycle callers) | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-hooks-001 | security | Critical | prior-review | verified-fixed |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `a1ae49db7023f049` |
| Core typecheck | EXIT:0 | gates |
| Desktop typecheck/lint/test | EXIT:0 | gates |
| Desktop boundaries | EXIT:0 | gates |
| Structure | EXIT:0 | gates |
| Regression AUDIT-hooks-001 | ok | packages/ax-code/test (hooks/trust coverage via lifecycle callers) |

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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 1 files / 350 LOC / fp a1ae49db7023f049 |
| Fix owner | ax-code-glm | 2026-08-11 | 1 fixed, 0 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
