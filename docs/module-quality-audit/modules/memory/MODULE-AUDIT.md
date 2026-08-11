# MODULE-AUDIT: memory

| Field | Value |
|-------|-------|
| Unit slug | `memory` |
| Scope | `packages/ax-code/src/memory` |
| Resolved root | `packages/ax-code/src/memory` |
| XL filter | no |
| Wave / effort | Wave 2 / M |
| Risk tags | correctness |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `94e95c161c7deb8e055d8806a5f285e516285715` |
| Analysis fingerprint | `aba2f110416ed53e` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 11 / 2009 |
| Inventory ID | W2-10 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/memory/applicability.ts` | 68 | 8 | 0 | 0 |
| `packages/ax-code/src/memory/doctor.ts` | 297 | 6 | 0 | 0 |
| `packages/ax-code/src/memory/evaluation.ts` | 159 | 8 | 0 | 0 |
| `packages/ax-code/src/memory/generator.ts` | 328 | 4 | 0 | 0 |
| `packages/ax-code/src/memory/hash.ts` | 50 | 3 | 0 | 0 |
| `packages/ax-code/src/memory/index.ts` | 45 | 0 | 0 | 0 |
| `packages/ax-code/src/memory/injector.ts` | 231 | 4 | 0 | 0 |
| `packages/ax-code/src/memory/recall.ts` | 213 | 3 | 0 | 0 |
| `packages/ax-code/src/memory/recorder.ts` | 235 | 4 | 0 | 0 |
| `packages/ax-code/src/memory/store.ts` | 307 | 13 | 0 | 0 |
| `packages/ax-code/src/memory/types.ts` | 76 | 7 | 0 | 0 |

### Exports (sample)
- `MemoryApplicabilityOptions@packages/ax-code/src/memory/applicability.ts:6`
- `normalizeTags@packages/ax-code/src/memory/applicability.ts:15`
- `isExpired@packages/ax-code/src/memory/applicability.ts:20`
- `matchesAgent@packages/ax-code/src/memory/applicability.ts:26`
- `matchesTags@packages/ax-code/src/memory/applicability.ts:32`
- `normalizePathForMatch@packages/ax-code/src/memory/applicability.ts:38`
- `matchesPath@packages/ax-code/src/memory/applicability.ts:50`
- `entryApplies@packages/ax-code/src/memory/applicability.ts:62`
- `MemoryDoctorStatus@packages/ax-code/src/memory/doctor.ts:5`
- `MemoryDoctorSource@packages/ax-code/src/memory/doctor.ts:6`
- `MemoryDoctorIssue@packages/ax-code/src/memory/doctor.ts:8`
- `MemoryDoctorReport@packages/ax-code/src/memory/doctor.ts:27`
- `MemoryDoctorOptions@packages/ax-code/src/memory/doctor.ts:42`
- `doctor@packages/ax-code/src/memory/doctor.ts:51`
- `MemoryEvaluationCase@packages/ax-code/src/memory/evaluation.ts:27`
- `MemoryEvaluationFile@packages/ax-code/src/memory/evaluation.ts:28`
- `MemoryEvaluationOptions@packages/ax-code/src/memory/evaluation.ts:30`
- `MemoryEvaluationCaseResult@packages/ax-code/src/memory/evaluation.ts:38`
- `MemoryEvaluationReport@packages/ax-code/src/memory/evaluation.ts:52`
- `parseMemoryEvaluationFileText@packages/ax-code/src/memory/evaluation.ts:68`

### Tests
- `packages/ax-code/test/cli/memory.test.ts`
- `packages/ax-code/test/debug-engine/pattern-memory.test.ts`
- `packages/ax-code/test/memory/abort-leak.test.ts`
- `packages/ax-code/test/memory/applicability.test.ts`
- `packages/ax-code/test/memory/doctor.test.ts`
- `packages/ax-code/test/memory/evaluation.test.ts`
- `packages/ax-code/test/memory/generator.test.ts`
- `packages/ax-code/test/memory/recall.test.ts`
- `packages/ax-code/test/memory/recorder.test.ts`
- `packages/ax-code/test/memory/store.test.ts`
- `packages/ax-code/test/mode/memory.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (60) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags correctness | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `aba2f110416ed53e` |
| Dual-agent protocol | PENDING |
| Critical independent verify | pending |

### Exit checklist
- [ ] Full 9-step protocol by dual-agent/implementer
- [x] Map with unit-scoped files (XL filters applied when configured)
- [x] Findings ledger consistent with findings/ files
- [ ] Sign-off roles complete

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | — | — | protocol pending |
| Independent verifier | — | — | pending |
| Module owner | — | — | REVIEWING |
