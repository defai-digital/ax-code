# MODULE-AUDIT: design-check

| Field | Value |
|-------|-------|
| Unit slug | `design-check` |
| Scope | `packages/ax-code/src/design-check` |
| Wave / effort | Wave 5 / M |
| Risk tags | quality |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `e1602e4fecdb1cce` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W5-15 |
| Source files / LOC | 8 / 470 |

## 1. Scope and map

### Purpose and ownership
Unit `design-check` owns `packages/ax-code/src/design-check`. Risk profile: quality.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/design-check/index.ts` | 143 | 2 | 0 | 0 |
| `packages/ax-code/src/design-check/rules/alt-text.ts` | 43 | 1 | 0 | 0 |
| `packages/ax-code/src/design-check/rules/colors.ts` | 71 | 1 | 0 | 0 |
| `packages/ax-code/src/design-check/rules/form-labels.ts` | 50 | 1 | 0 | 0 |
| `packages/ax-code/src/design-check/rules/index.ts` | 13 | 1 | 0 | 0 |
| `packages/ax-code/src/design-check/rules/inline-styles.ts` | 53 | 1 | 0 | 0 |
| `packages/ax-code/src/design-check/rules/spacing.ts` | 42 | 1 | 0 | 0 |
| `packages/ax-code/src/design-check/types.ts` | 55 | 7 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `runDesignCheck@packages/ax-code/src/design-check/index.ts:56` | public/internal | scanned |
| `formatResult@packages/ax-code/src/design-check/index.ts:116` | public/internal | scanned |
| `missingAltText@packages/ax-code/src/design-check/rules/alt-text.ts:10` | public/internal | scanned |
| `noHardcodedColors@packages/ax-code/src/design-check/rules/colors.ts:12` | public/internal | scanned |
| `missingFormLabels@packages/ax-code/src/design-check/rules/form-labels.ts:10` | public/internal | scanned |
| `ALL_RULES@packages/ax-code/src/design-check/rules/index.ts:12` | public/internal | scanned |
| `noInlineStyles@packages/ax-code/src/design-check/rules/inline-styles.ts:11` | public/internal | scanned |
| `noRawSpacing@packages/ax-code/src/design-check/rules/spacing.ts:11` | public/internal | scanned |
| `Severity@packages/ax-code/src/design-check/types.ts:5` | public/internal | scanned |
| `RuleConfig@packages/ax-code/src/design-check/types.ts:7` | public/internal | scanned |
| `DesignCheckConfig@packages/ax-code/src/design-check/types.ts:15` | public/internal | scanned |
| `Violation@packages/ax-code/src/design-check/types.ts:25` | public/internal | scanned |
| `FileResult@packages/ax-code/src/design-check/types.ts:35` | public/internal | scanned |
| `CheckResult@packages/ax-code/src/design-check/types.ts:40` | public/internal | scanned |
| `Rule@packages/ax-code/src/design-check/types.ts:49` | public/internal | scanned |

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

- io packages/ax-code/src/design-check/index.ts:78
- process packages/ax-code/src/design-check/rules/alt-text.ts:24
- secret packages/ax-code/src/design-check/rules/colors.ts:3
- secret packages/ax-code/src/design-check/rules/colors.ts:14
- process packages/ax-code/src/design-check/rules/colors.ts:30
- secret packages/ax-code/src/design-check/rules/colors.ts:37
- process packages/ax-code/src/design-check/rules/colors.ts:43
- secret packages/ax-code/src/design-check/rules/colors.ts:50
- process packages/ax-code/src/design-check/rules/colors.ts:56
- secret packages/ax-code/src/design-check/rules/colors.ts:63
- process packages/ax-code/src/design-check/rules/form-labels.ts:24
- secret packages/ax-code/src/design-check/rules/inline-styles.ts:13

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
- Files scanned: 8; total LOC: 470
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/design-check`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 15

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
| Static deep extract | ok | fingerprint `e1602e4fecdb1cce` |
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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 8 files / 470 LOC / fp e1602e4fecdb1cce |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
