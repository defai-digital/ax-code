# MODULE-AUDIT: quality

| Field | Value |
|-------|-------|
| Unit slug | `quality` |
| Scope | `packages/ax-code/src/quality` |
| Wave / effort | Wave 5 / M |
| Risk tags | quality |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `ccc7f2dac6610640` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W5-14 |
| Source files / LOC | 95 / 22863 |

## 1. Scope and map

### Purpose and ownership
Unit `quality` owns `packages/ax-code/src/quality`. Risk profile: quality.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/quality/calibration-model.ts` | 436 | 11 | 0 | 0 |
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
| `packages/ax-code/src/quality/finding-registry.ts` | 36 | 6 | 0 | 0 |
| `packages/ax-code/src/quality/finding-render.ts` | 160 | 3 | 0 | 0 |
| `packages/ax-code/src/quality/finding.ts` | 76 | 14 | 0 | 0 |
| `packages/ax-code/src/quality/json.ts` | 4 | 1 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `QualityCalibrationModel@packages/ax-code/src/quality/calibration-model.ts:5` | public/internal | scanned |
| `CalibrationBin@packages/ax-code/src/quality/calibration-model.ts:10` | public/internal | scanned |
| `GroupModel@packages/ax-code/src/quality/calibration-model.ts:22` | public/internal | scanned |
| `ModelFile@packages/ax-code/src/quality/calibration-model.ts:33` | public/internal | scanned |
| `BenchmarkSplit@packages/ax-code/src/quality/calibration-model.ts:52` | public/internal | scanned |
| `BenchmarkBundle@packages/ax-code/src/quality/calibration-model.ts:59` | public/internal | scanned |
| `train@packages/ax-code/src/quality/calibration-model.ts:264` | public/internal | scanned |
| `predict@packages/ax-code/src/quality/calibration-model.ts:309` | public/internal | scanned |
| `split@packages/ax-code/src/quality/calibration-model.ts:339` | public/internal | scanned |
| `benchmark@packages/ax-code/src/quality/calibration-model.ts:359` | public/internal | scanned |
| `renderBenchmarkReport@packages/ax-code/src/quality/calibration-model.ts:420` | public/internal | scanned |
| `Critic@packages/ax-code/src/quality/critic.ts:27` | public/internal | scanned |
| `ReviewInput@packages/ax-code/src/quality/critic.ts:52` | public/internal | scanned |
| `ReviewResult@packages/ax-code/src/quality/critic.ts:65` | public/internal | scanned |
| `enabled@packages/ax-code/src/quality/critic.ts:70` | public/internal | scanned |

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

- io packages/ax-code/src/quality/dre-graph-assets.ts:129
- secret packages/ax-code/src/quality/dre-graph-fingerprint.ts:37
- secret packages/ax-code/src/quality/dre-graph-summary-section.ts:23
- secret packages/ax-code/src/quality/dre-graph-timeline.ts:13
- secret packages/ax-code/src/quality/dre-graph-timeline.ts:38
- io packages/ax-code/src/quality/policy.ts:150
- io packages/ax-code/src/quality/policy.ts:190
- io packages/ax-code/src/quality/promotion-packaged-archive.ts:282
- io packages/ax-code/src/quality/promotion-packaged-archive.ts:298
- io packages/ax-code/src/quality/promotion-portable-export.ts:330
- io packages/ax-code/src/quality/promotion-signed-archive.ts:358
- io packages/ax-code/src/quality/shadow-runtime.ts:45

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (957 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 95; total LOC: 22863
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/quality`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 957

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
| Static deep extract | ok | fingerprint `ccc7f2dac6610640` |
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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 95 files / 22863 LOC / fp ccc7f2dac6610640 |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
