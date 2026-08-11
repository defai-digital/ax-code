# MODULE-AUDIT: skill

| Field | Value |
|-------|-------|
| Unit slug | `skill` |
| Scope | `packages/ax-code/src/skill` |
| Resolved root | `packages/ax-code/src/skill` |
| XL filter | no |
| Wave / effort | Wave 5 / L |
| Risk tags | security |
| Status | SIGNED OFF |
| Reviewer | implementer |
| Independent verifier | codex-sol |
| Baseline commit | `054002dd73198d659d505539f080200bdbc66bc8` |
| Analysis fingerprint | `75cae2d71fae2c55` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 4 / 877 |
| Inventory ID | W5-12 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/skill/authoring.ts` | 221 | 25 | 0 | 0 |
| `packages/ax-code/src/skill/discovery.ts` | 208 | 5 | 0 | 0 |
| `packages/ax-code/src/skill/index.ts` | 415 | 11 | 0 | 0 |
| `packages/ax-code/src/skill/validate.ts` | 33 | 4 | 0 | 0 |

### Exports (sample)
- `SkillValidationIssue@packages/ax-code/src/skill/authoring.ts:15`
- `SkillValidationIssue@packages/ax-code/src/skill/authoring.ts:20`
- `SkillValidationReport@packages/ax-code/src/skill/authoring.ts:22`
- `SkillValidationReport@packages/ax-code/src/skill/authoring.ts:28`
- `SkillDoctorReport@packages/ax-code/src/skill/authoring.ts:30`
- `SkillDoctorReport@packages/ax-code/src/skill/authoring.ts:33`
- `SkillTriggerMatch@packages/ax-code/src/skill/authoring.ts:35`
- `SkillTriggerMatch@packages/ax-code/src/skill/authoring.ts:42`
- `SkillTriggerReport@packages/ax-code/src/skill/authoring.ts:44`
- `SkillTriggerReport@packages/ax-code/src/skill/authoring.ts:48`
- `SkillTriggerRequest@packages/ax-code/src/skill/authoring.ts:50`
- `SkillTriggerRequest@packages/ax-code/src/skill/authoring.ts:53`
- `SkillCreateRequest@packages/ax-code/src/skill/authoring.ts:60`
- `SkillCreateRequest@packages/ax-code/src/skill/authoring.ts:69`
- `SkillCreateResult@packages/ax-code/src/skill/authoring.ts:71`
- `SkillCreateResult@packages/ax-code/src/skill/authoring.ts:74`
- `SkillExistsError@packages/ax-code/src/skill/authoring.ts:76`
- `SkillPathError@packages/ax-code/src/skill/authoring.ts:83`
- `SkillInputError@packages/ax-code/src/skill/authoring.ts:90`
- `buildSkillValidationReport@packages/ax-code/src/skill/authoring.ts:121`

### Tests
- `packages/ax-code/test/cli/skill.test.ts`
- `packages/ax-code/test/cli/tui/skill-list-data.test.ts`
- `packages/ax-code/test/server/skill.test.ts`
- `packages/ax-code/test/skill/discovery.test.ts`
- `packages/ax-code/test/skill/skill.test.ts`
- `packages/ax-code/test/tool/skill.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (45) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags security | hotspot scan |

## 3–7. Protocol steps 3–7

Step 1: Mapped 4 source files; exports≈45
Step 2: Threat: secrets=0 files, processRisk=0 files, emptyCatch=0
Step 3: Correctness: read control flow for public surfaces; findings=none
Step 4: Performance: not hot-path; spot-checked
Step 5: Design: ownership vs ARCHITECTURE/PROJECT_BOUNDARIES for packages/ax-code/src/skill
Step 6: Hygiene: empty=0; notes: clean
Step 7: Tests: see MODULE-AUDIT matched tests; regressions for verified-fixed findings
Step 8: Findings disposition complete in findings/
Step 9: Verification commands recorded in STATUS gates; protocol marker written

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `75cae2d71fae2c55` |
| Dual-agent protocol | complete |
| Critical independent verify | codex-sol |

### Exit checklist
- [x] Full 9-step protocol by dual-agent/implementer
- [x] Map with unit-scoped files (XL filters applied when configured)
- [x] Findings ledger consistent with findings/ files
- [x] Sign-off roles complete

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | implementer | 2026-08-11 | filesRead=4 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
