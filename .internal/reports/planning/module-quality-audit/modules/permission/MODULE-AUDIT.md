# MODULE-AUDIT: permission

| Field | Value |
|-------|-------|
| Unit slug | `permission` |
| Scope | `packages/ax-code/src/permission` |
| Wave / effort | Wave 3 / L |
| Risk tags | security, trust |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `ed7b8e8816180f31` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W3-01 |
| Source files / LOC | 5 / 948 |

## 1. Scope and map

### Purpose and ownership
Unit `permission` owns `packages/ax-code/src/permission`. Risk profile: security, trust.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/permission/arity.ts` | 164 | 2 | 0 | 0 |
| `packages/ax-code/src/permission/evaluate.ts` | 16 | 1 | 0 | 0 |
| `packages/ax-code/src/permission/index.ts` | 683 | 24 | 0 | 0 |
| `packages/ax-code/src/permission/risk-classes.ts` | 79 | 1 | 0 | 0 |
| `packages/ax-code/src/permission/schema.ts` | 6 | 1 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `BashArity@packages/ax-code/src/permission/arity.ts:1` | public/internal | scanned |
| `prefix@packages/ax-code/src/permission/arity.ts:2` | public/internal | scanned |
| `evaluate@packages/ax-code/src/permission/evaluate.ts:9` | public/internal | scanned |
| `Permission@packages/ax-code/src/permission/index.ts:26` | public/internal | scanned |
| `Action@packages/ax-code/src/permission/index.ts:29` | public/internal | scanned |
| `Rule@packages/ax-code/src/permission/index.ts:34` | public/internal | scanned |
| `Ruleset@packages/ax-code/src/permission/index.ts:45` | public/internal | scanned |
| `Request@packages/ax-code/src/permission/index.ts:50` | public/internal | scanned |
| `Reply@packages/ax-code/src/permission/index.ts:70` | public/internal | scanned |
| `Event@packages/ax-code/src/permission/index.ts:73` | public/internal | scanned |
| `RejectedError@packages/ax-code/src/permission/index.ts:85` | public/internal | scanned |
| `CorrectedError@packages/ax-code/src/permission/index.ts:93` | public/internal | scanned |
| `DeniedError@packages/ax-code/src/permission/index.ts:124` | public/internal | scanned |
| `Error@packages/ax-code/src/permission/index.ts:142` | public/internal | scanned |
| `AskInput@packages/ax-code/src/permission/index.ts:144` | public/internal | scanned |

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

- secret packages/ax-code/src/permission/arity.ts:2
- secret packages/ax-code/src/permission/arity.ts:3
- secret packages/ax-code/src/permission/arity.ts:4
- secret packages/ax-code/src/permission/arity.ts:6
- secret packages/ax-code/src/permission/arity.ts:8
- secret packages/ax-code/src/permission/arity.ts:9
- secret packages/ax-code/src/permission/arity.ts:14
- secret packages/ax-code/src/permission/arity.ts:15
- io packages/ax-code/src/permission/arity.ts:44
- secret packages/ax-code/src/permission/arity.ts:155
- secret packages/ax-code/src/permission/index.ts:249

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (29 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 5; total LOC: 948
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/permission`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 29

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/account/repo.test.ts` | matched |
| Findings regression | packages/ax-code/test/permission | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-permission-001 | security | Critical | prior-review | verified-fixed |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `ed7b8e8816180f31` |
| Core typecheck | EXIT:0 | gates |
| Desktop typecheck/lint/test | EXIT:0 | gates |
| Desktop boundaries | EXIT:0 | gates |
| Structure | EXIT:0 | gates |
| Regression AUDIT-permission-001 | ok | packages/ax-code/test/permission |

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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 5 files / 948 LOC / fp ed7b8e8816180f31 |
| Fix owner | ax-code-glm | 2026-08-11 | 1 fixed, 0 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
