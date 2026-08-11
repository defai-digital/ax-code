# MODULE-AUDIT: visual

| Field | Value |
|-------|-------|
| Unit slug | `visual` |
| Scope | `packages/ax-code/src/visual` |
| Resolved root | `packages/ax-code/src/visual` |
| XL filter | no |
| Wave / effort | Wave 10 / M |
| Risk tags | quality |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `046510f0ca8a215f632e99fa92aa0633d684cbb9` |
| Analysis fingerprint | `b806668128b521f1` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 13 / 1810 |
| Inventory ID | W10-05 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/visual/artifact.ts` | 194 | 8 | 0 | 0 |
| `packages/ax-code/src/visual/capability.ts` | 92 | 6 | 0 | 0 |
| `packages/ax-code/src/visual/compare.ts` | 177 | 5 | 0 | 0 |
| `packages/ax-code/src/visual/findings.ts` | 147 | 7 | 0 | 0 |
| `packages/ax-code/src/visual/index.ts` | 17 | 0 | 0 | 0 |
| `packages/ax-code/src/visual/native.ts` | 300 | 3 | 0 | 0 |
| `packages/ax-code/src/visual/permission.ts` | 88 | 8 | 0 | 0 |
| `packages/ax-code/src/visual/repair.ts` | 205 | 10 | 0 | 0 |
| `packages/ax-code/src/visual/risk-summary.ts` | 112 | 5 | 0 | 0 |
| `packages/ax-code/src/visual/router.ts` | 106 | 4 | 0 | 0 |
| `packages/ax-code/src/visual/run.ts` | 82 | 11 | 0 | 0 |
| `packages/ax-code/src/visual/snapshot.ts` | 146 | 4 | 0 | 0 |
| `packages/ax-code/src/visual/viewport.ts` | 144 | 6 | 0 | 0 |

### Exports (sample)
- `VisualArtifactStore@packages/ax-code/src/visual/artifact.ts:45`
- `baseDir@packages/ax-code/src/visual/artifact.ts:49`
- `runDir@packages/ax-code/src/visual/artifact.ts:56`
- `ensureRunDir@packages/ax-code/src/visual/artifact.ts:64`
- `writeScreenshot@packages/ax-code/src/visual/artifact.ts:73`
- `writeText@packages/ax-code/src/visual/artifact.ts:113`
- `writeRunSummary@packages/ax-code/src/visual/artifact.ts:143`
- `prune@packages/ax-code/src/visual/artifact.ts:152`
- `ModelReasoningLevel@packages/ax-code/src/visual/capability.ts:11`
- `ModelSearchMode@packages/ax-code/src/visual/capability.ts:12`
- `ModelVisualCapabilities@packages/ax-code/src/visual/capability.ts:14`
- `hasVisualCapabilities@packages/ax-code/src/visual/capability.ts:29`
- `missingCapabilityDiagnostic@packages/ax-code/src/visual/capability.ts:48`
- `toVisualCapabilities@packages/ax-code/src/visual/capability.ts:74`
- `CompareMatch@packages/ax-code/src/visual/compare.ts:10`
- `CompareDelta@packages/ax-code/src/visual/compare.ts:17`
- `CompareResult@packages/ax-code/src/visual/compare.ts:24`
- `compareVisualRuns@packages/ax-code/src/visual/compare.ts:92`
- `formatCompareSummary@packages/ax-code/src/visual/compare.ts:142`
- `FindingsSummary@packages/ax-code/src/visual/findings.ts:11`

### Tests
- `packages/ax-code/test/cli/tui/visual-primitives.test.ts`
- `packages/ax-code/test/tool/visual-compare.test.ts`
- `packages/ax-code/test/tool/visual-critique.test.ts`
- `packages/ax-code/test/tool/visual-snapshot.test.ts`
- `packages/ax-code/test/visual/artifact.test.ts`
- `packages/ax-code/test/visual/capability.test.ts`
- `packages/ax-code/test/visual/compare.test.ts`
- `packages/ax-code/test/visual/findings.test.ts`
- `packages/ax-code/test/visual/native.test.ts`
- `packages/ax-code/test/visual/permission.test.ts`
- `packages/ax-code/test/visual/repair.test.ts`
- `packages/ax-code/test/visual/risk-summary.test.ts`
- `packages/ax-code/test/visual/router.test.ts`
- `packages/ax-code/test/visual/snapshot.test.ts`
- `packages/ax-code/test/visual/viewport.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (77) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags quality | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `b806668128b521f1` |
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
