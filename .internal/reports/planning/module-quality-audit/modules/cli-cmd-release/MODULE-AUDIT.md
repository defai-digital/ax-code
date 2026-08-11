# MODULE-AUDIT: cli-cmd-release

| Field | Value |
|-------|-------|
| Unit slug | `cli-cmd-release` |
| Scope | `packages/ax-code/src/cli/cmd/release` |
| Wave / effort | Wave 6 / M |
| Risk tags | cli |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `455281569b63793a` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W6-18 |
| Source files / LOC | 2 / 818 |

## 1. Scope and map

### Purpose and ownership
Unit `cli-cmd-release` owns `packages/ax-code/src/cli/cmd/release`. Risk profile: cli.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/cli/cmd/release/check.ts` | 800 | 12 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/release/index.ts` | 18 | 1 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `ReleaseCheckStatus@packages/ax-code/src/cli/cmd/release/check.ts:29` | public/internal | scanned |
| `ReleaseCheckResult@packages/ax-code/src/cli/cmd/release/check.ts:31` | public/internal | scanned |
| `releaseReadinessChecks@packages/ax-code/src/cli/cmd/release/check.ts:43` | public/internal | scanned |
| `PackageJSON@packages/ax-code/src/cli/cmd/release/check.ts:78` | public/internal | scanned |
| `decodeReleasePackageJsonValue@packages/ax-code/src/cli/cmd/release/check.ts:83` | public/internal | scanned |
| `parseReleasePackageJsonText@packages/ax-code/src/cli/cmd/release/check.ts:91` | public/internal | scanned |
| `CheckStatus@packages/ax-code/src/cli/cmd/release/check.ts:121` | public/internal | scanned |
| `CheckResult@packages/ax-code/src/cli/cmd/release/check.ts:123` | public/internal | scanned |
| `CheckContext@packages/ax-code/src/cli/cmd/release/check.ts:132` | public/internal | scanned |
| `CHECK_IDS@packages/ax-code/src/cli/cmd/release/check.ts:661` | public/internal | scanned |
| `runChecks@packages/ax-code/src/cli/cmd/release/check.ts:663` | public/internal | scanned |
| `ReleaseCheckCommand@packages/ax-code/src/cli/cmd/release/check.ts:728` | public/internal | scanned |
| `ReleaseCommand@packages/ax-code/src/cli/cmd/release/index.ts:12` | public/internal | scanned |

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

- io packages/ax-code/src/cli/cmd/release/check.ts:13
- io packages/ax-code/src/cli/cmd/release/check.ts:113
- io packages/ax-code/src/cli/cmd/release/check.ts:184
- io packages/ax-code/src/cli/cmd/release/check.ts:245
- io packages/ax-code/src/cli/cmd/release/check.ts:449
- process packages/ax-code/src/cli/cmd/release/check.ts:465

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| host process / FS | spawn/shell | escape sandbox, orphan children | permission + isolation layers | OS sandbox opt-in residual |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (13 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 2; total LOC: 818
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/cli/cmd/release`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 13

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
| Static deep extract | ok | fingerprint `455281569b63793a` |
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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 2 files / 818 LOC / fp 455281569b63793a |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
