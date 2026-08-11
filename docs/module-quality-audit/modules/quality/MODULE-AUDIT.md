# MODULE-AUDIT: quality

| Field | Value |
|-------|-------|
| Unit slug | `quality` |
| Scope | `packages/ax-code/src/quality` |
| Resolved root | `packages/ax-code/src/quality` |
| XL filter | no |
| Wave / effort | Wave 5 / M |
| Risk tags | quality |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `046510f0ca8a215f632e99fa92aa0633d684cbb9` |
| Analysis fingerprint | `21a8e70e81e5889f` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 95 / 22863 |
| Inventory ID | W5-14 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/quality/calibration-model.ts` | 436 | 16 | 0 | 0 |
| `packages/ax-code/src/quality/critic.ts` | 300 | 9 | 0 | 0 |
| `packages/ax-code/src/quality/digest.ts` | 14 | 2 | 0 | 0 |
| `packages/ax-code/src/quality/dre-graph-activity-section.ts` | 187 | 1 | 0 | 0 |
| `packages/ax-code/src/quality/dre-graph-activity.ts` | 54 | 3 | 0 | 0 |
| `packages/ax-code/src/quality/dre-graph-assets.ts` | 228 | 4 | 0 | 0 |
| `packages/ax-code/src/quality/dre-graph-branch-section.ts` | 92 | 1 | 0 | 0 |
| `packages/ax-code/src/quality/dre-graph-changes-section.ts` | 41 | 1 | 0 | 0 |
| `packages/ax-code/src/quality/dre-graph-fingerprint.ts` | 96 | 2 | 0 | 0 |
| `packages/ax-code/src/quality/dre-graph-format.ts` | 90 | 11 | 0 | 0 |
| `packages/ax-code/src/quality/dre-graph-index-page.ts` | 116 | 2 | 0 | 0 |
| `packages/ax-code/src/quality/dre-graph-quality-readiness.ts` | 50 | 1 | 0 | 0 |
| `packages/ax-code/src/quality/dre-graph-risk-section.ts` | 173 | 1 | 0 | 0 |
| `packages/ax-code/src/quality/dre-graph-rollback.ts` | 41 | 2 | 0 | 0 |
| `packages/ax-code/src/quality/dre-graph-style.ts` | 537 | 1 | 0 | 0 |
| `packages/ax-code/src/quality/dre-graph-summary-section.ts` | 50 | 1 | 0 | 0 |
| `packages/ax-code/src/quality/dre-graph-timeline.ts` | 101 | 5 | 0 | 0 |
| `packages/ax-code/src/quality/dre-graph-validation-section.ts` | 38 | 1 | 0 | 0 |
| `packages/ax-code/src/quality/dre-graph-verdict-section.ts` | 68 | 1 | 0 | 0 |
| `packages/ax-code/src/quality/dre-graph-widgets.ts` | 120 | 6 | 0 | 0 |
| `packages/ax-code/src/quality/finding-counts.ts` | 43 | 5 | 0 | 0 |
| `packages/ax-code/src/quality/finding-registry.ts` | 36 | 11 | 0 | 0 |
| `packages/ax-code/src/quality/finding-render.ts` | 160 | 3 | 0 | 0 |
| `packages/ax-code/src/quality/finding.ts` | 76 | 17 | 0 | 0 |
| `packages/ax-code/src/quality/json.ts` | 4 | 1 | 0 | 0 |
| `packages/ax-code/src/quality/label-store.ts` | 85 | 8 | 0 | 0 |
| `packages/ax-code/src/quality/model-registry/index.ts` | 319 | 43 | 0 | 0 |
| `packages/ax-code/src/quality/model-registry/promote-bundle.ts` | 426 | 5 | 0 | 0 |
| `packages/ax-code/src/quality/model-registry/promote.ts` | 288 | 3 | 0 | 0 |
| `packages/ax-code/src/quality/model-registry/promotion-summary.ts` | 19 | 4 | 0 | 0 |

### Exports (sample)
- `QualityCalibrationModel@packages/ax-code/src/quality/calibration-model.ts:5`
- `CalibrationBin@packages/ax-code/src/quality/calibration-model.ts:10`
- `CalibrationBin@packages/ax-code/src/quality/calibration-model.ts:20`
- `GroupModel@packages/ax-code/src/quality/calibration-model.ts:22`
- `GroupModel@packages/ax-code/src/quality/calibration-model.ts:31`
- `ModelFile@packages/ax-code/src/quality/calibration-model.ts:33`
- `ModelFile@packages/ax-code/src/quality/calibration-model.ts:50`
- `BenchmarkSplit@packages/ax-code/src/quality/calibration-model.ts:52`
- `BenchmarkSplit@packages/ax-code/src/quality/calibration-model.ts:57`
- `BenchmarkBundle@packages/ax-code/src/quality/calibration-model.ts:59`
- `BenchmarkBundle@packages/ax-code/src/quality/calibration-model.ts:68`
- `train@packages/ax-code/src/quality/calibration-model.ts:264`
- `predict@packages/ax-code/src/quality/calibration-model.ts:309`
- `split@packages/ax-code/src/quality/calibration-model.ts:339`
- `benchmark@packages/ax-code/src/quality/calibration-model.ts:359`
- `renderBenchmarkReport@packages/ax-code/src/quality/calibration-model.ts:420`
- `Critic@packages/ax-code/src/quality/critic.ts:27`
- `ReviewInput@packages/ax-code/src/quality/critic.ts:52`
- `ReviewResult@packages/ax-code/src/quality/critic.ts:65`
- `enabled@packages/ax-code/src/quality/critic.ts:70`

### Tests
- `packages/ax-code/test/cli/tui/session-quality.test.ts`
- `packages/ax-code/test/quality/calibration-model.test.ts`
- `packages/ax-code/test/quality/critic-classify.test.ts`
- `packages/ax-code/test/quality/dre-graph-activity-section.test.ts`
- `packages/ax-code/test/quality/dre-graph-activity.test.ts`
- `packages/ax-code/test/quality/dre-graph-assets.test.ts`
- `packages/ax-code/test/quality/dre-graph-branch-section.test.ts`
- `packages/ax-code/test/quality/dre-graph-changes-section.test.ts`
- `packages/ax-code/test/quality/dre-graph-fingerprint.test.ts`
- `packages/ax-code/test/quality/dre-graph-format.test.ts`
- `packages/ax-code/test/quality/dre-graph-index-page.test.ts`
- `packages/ax-code/test/quality/dre-graph-quality-readiness.test.ts`
- `packages/ax-code/test/quality/dre-graph-risk-section.test.ts`
- `packages/ax-code/test/quality/dre-graph-rollback.test.ts`
- `packages/ax-code/test/quality/dre-graph-style.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (1251) | static map |
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
| Static extract | ok fp `21a8e70e81e5889f` |
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
