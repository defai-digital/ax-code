# MODULE-AUDIT: planner

| Field | Value |
|-------|-------|
| Unit slug | `planner` |
| Scope | `packages/ax-code/src/planner` |
| Resolved root | `packages/ax-code/src/planner` |
| XL filter | no |
| Wave / effort | Wave 2 / M |
| Risk tags | correctness |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `5fefa00cdc847667d3ba3d38509a751498ee4180` |
| Analysis fingerprint | `d5339ffa8bec8911` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 10 / 2159 |
| Inventory ID | W2-05 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/planner/complexity.ts` | 145 | 4 | 0 | 0 |
| `packages/ax-code/src/planner/dependency.ts` | 160 | 3 | 0 | 0 |
| `packages/ax-code/src/planner/estimator.ts` | 113 | 5 | 0 | 0 |
| `packages/ax-code/src/planner/index.ts` | 541 | 17 | 0 | 0 |
| `packages/ax-code/src/planner/replan-llm.ts` | 203 | 12 | 0 | 0 |
| `packages/ax-code/src/planner/types.ts` | 205 | 19 | 0 | 0 |
| `packages/ax-code/src/planner/verification/check-policy.ts` | 127 | 4 | 0 | 0 |
| `packages/ax-code/src/planner/verification/index.ts` | 226 | 7 | 0 | 0 |
| `packages/ax-code/src/planner/verification/repair-handoff.ts` | 155 | 4 | 0 | 0 |
| `packages/ax-code/src/planner/verification/runner.ts` | 284 | 11 | 0 | 0 |

### Exports (sample)
- `ComplexityHint@packages/ax-code/src/planner/complexity.ts:41`
- `isComplex@packages/ax-code/src/planner/complexity.ts:52`
- `score@packages/ax-code/src/planner/complexity.ts:78`
- `minPhases@packages/ax-code/src/planner/complexity.ts:110`
- `ResolutionResult@packages/ax-code/src/planner/dependency.ts:11`
- `resolve@packages/ax-code/src/planner/dependency.ts:22`
- `ready@packages/ax-code/src/planner/dependency.ts:118`
- `phase@packages/ax-code/src/planner/estimator.ts:44`
- `plan@packages/ax-code/src/planner/estimator.ts:60`
- `batch@packages/ax-code/src/planner/estimator.ts:72`
- `phaseDuration@packages/ax-code/src/planner/estimator.ts:84`
- `planDuration@packages/ax-code/src/planner/estimator.ts:98`
- `Planner@packages/ax-code/src/planner/index.ts:63`
- `ComplexityHint@packages/ax-code/src/planner/index.ts:71`
- `shouldPlan@packages/ax-code/src/planner/index.ts:79`
- `complexityScore@packages/ax-code/src/planner/index.ts:87`
- `estimatePhases@packages/ax-code/src/planner/index.ts:94`
- `create@packages/ax-code/src/planner/index.ts:105`
- `execute@packages/ax-code/src/planner/index.ts:137`
- `verifyPhase@packages/ax-code/src/planner/index.ts:493`

### Tests
- `packages/ax-code/test/planner/check-policy.test.ts`
- `packages/ax-code/test/planner/complexity-hint.test.ts`
- `packages/ax-code/test/planner/constraints.test.ts`
- `packages/ax-code/test/planner/index.test.ts`
- `packages/ax-code/test/planner/phase-reviewer.test.ts`
- `packages/ax-code/test/planner/repair-handoff.test.ts`
- `packages/ax-code/test/planner/replan-llm.test.ts`
- `packages/ax-code/test/planner/replan.test.ts`
- `packages/ax-code/test/planner/verification-runner.test.ts`
- `packages/ax-code/test/planner/verification.test.ts`
- `packages/ax-code/test/workflow/planner.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (86) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags correctness | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `d5339ffa8bec8911` |
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
| Reviewer | ax-code-glm | 2026-08-11 | filesRead=11 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
