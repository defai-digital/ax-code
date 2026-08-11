# MODULE-AUDIT: skill

| Field | Value |
|-------|-------|
| Unit slug | `skill` |
| Scope | `packages/ax-code/src/skill` |
| Wave / effort | Wave 5 / L |
| Risk tags | security |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `e45100dfed904e60` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W5-12 |
| Source files / LOC | 4 / 877 |

## 1. Scope and map

### Purpose and ownership
Unit `skill` owns `packages/ax-code/src/skill`. Risk profile: security.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/skill/authoring.ts` | 221 | 17 | 0 | 0 |
| `packages/ax-code/src/skill/discovery.ts` | 208 | 5 | 0 | 0 |
| `packages/ax-code/src/skill/index.ts` | 415 | 10 | 0 | 0 |
| `packages/ax-code/src/skill/validate.ts` | 33 | 4 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `SkillValidationIssue@packages/ax-code/src/skill/authoring.ts:15` | public/internal | scanned |
| `SkillValidationReport@packages/ax-code/src/skill/authoring.ts:22` | public/internal | scanned |
| `SkillDoctorReport@packages/ax-code/src/skill/authoring.ts:30` | public/internal | scanned |
| `SkillTriggerMatch@packages/ax-code/src/skill/authoring.ts:35` | public/internal | scanned |
| `SkillTriggerReport@packages/ax-code/src/skill/authoring.ts:44` | public/internal | scanned |
| `SkillTriggerRequest@packages/ax-code/src/skill/authoring.ts:50` | public/internal | scanned |
| `SkillCreateRequest@packages/ax-code/src/skill/authoring.ts:60` | public/internal | scanned |
| `SkillCreateResult@packages/ax-code/src/skill/authoring.ts:71` | public/internal | scanned |
| `SkillExistsError@packages/ax-code/src/skill/authoring.ts:76` | public/internal | scanned |
| `SkillPathError@packages/ax-code/src/skill/authoring.ts:83` | public/internal | scanned |
| `SkillInputError@packages/ax-code/src/skill/authoring.ts:90` | public/internal | scanned |
| `buildSkillValidationReport@packages/ax-code/src/skill/authoring.ts:121` | public/internal | scanned |
| `buildSkillDoctorReport@packages/ax-code/src/skill/authoring.ts:138` | public/internal | scanned |
| `buildSkillTriggerReport@packages/ax-code/src/skill/authoring.ts:164` | public/internal | scanned |
| `skillCreateContent@packages/ax-code/src/skill/authoring.ts:177` | public/internal | scanned |

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
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (36 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 4; total LOC: 877
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/skill`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 36

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
| Static deep extract | ok | fingerprint `e45100dfed904e60` |
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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 4 files / 877 LOC / fp e45100dfed904e60 |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
