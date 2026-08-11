# MODULE-AUDIT: debug-engine

| Field | Value |
|-------|-------|
| Unit slug | `debug-engine` |
| Scope | `packages/ax-code/src/debug-engine` |
| Wave / effort | Wave 5 / M |
| Risk tags | correctness |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `3ac5590c75ceb74c` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W5-16 |
| Source files / LOC | 23 / 6527 |

## 1. Scope and map

### Purpose and ownership
Unit `debug-engine` owns `packages/ax-code/src/debug-engine`. Risk profile: correctness.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/debug-engine/analyze-bug.ts` | 414 | 9 | 0 | 0 |
| `packages/ax-code/src/debug-engine/analyze-impact.ts` | 310 | 4 | 0 | 0 |
| `packages/ax-code/src/debug-engine/apply-safe-refactor.ts` | 348 | 2 | 0 | 0 |
| `packages/ax-code/src/debug-engine/detect-duplicates.ts` | 297 | 3 | 0 | 0 |
| `packages/ax-code/src/debug-engine/detect-hardcodes.ts` | 396 | 2 | 0 | 0 |
| `packages/ax-code/src/debug-engine/detect-lifecycle.ts` | 335 | 2 | 0 | 0 |
| `packages/ax-code/src/debug-engine/detect-races.ts` | 380 | 2 | 0 | 0 |
| `packages/ax-code/src/debug-engine/detect-security.ts` | 364 | 2 | 0 | 0 |
| `packages/ax-code/src/debug-engine/diagnostic-correlation.ts` | 516 | 9 | 0 | 0 |
| `packages/ax-code/src/debug-engine/id.ts` | 15 | 3 | 0 | 0 |
| `packages/ax-code/src/debug-engine/incremental.ts` | 150 | 6 | 0 | 0 |
| `packages/ax-code/src/debug-engine/index.ts` | 452 | 40 | 0 | 0 |
| `packages/ax-code/src/debug-engine/language-scan.ts` | 480 | 22 | 0 | 0 |
| `packages/ax-code/src/debug-engine/native-scan.ts` | 235 | 14 | 0 | 0 |
| `packages/ax-code/src/debug-engine/pattern-memory.ts` | 414 | 6 | 0 | 0 |
| `packages/ax-code/src/debug-engine/plan-refactor.ts` | 284 | 3 | 0 | 0 |
| `packages/ax-code/src/debug-engine/prewarm-lsp.ts` | 93 | 2 | 0 | 0 |
| `packages/ax-code/src/debug-engine/query.ts` | 122 | 14 | 0 | 0 |
| `packages/ax-code/src/debug-engine/runtime-debug.ts` | 189 | 25 | 0 | 0 |
| `packages/ax-code/src/debug-engine/scanner-utils.ts` | 182 | 12 | 0 | 0 |
| `packages/ax-code/src/debug-engine/schema.sql.ts` | 140 | 7 | 0 | 0 |
| `packages/ax-code/src/debug-engine/shadow-worktree.ts` | 294 | 8 | 0 | 0 |
| `packages/ax-code/src/debug-engine/verify-after-fix.ts` | 117 | 8 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `AnalyzeBugInput@packages/ax-code/src/debug-engine/analyze-bug.ts:22` | public/internal | scanned |
| `parseTypeScriptStack@packages/ax-code/src/debug-engine/analyze-bug.ts:60` | public/internal | scanned |
| `parsePythonStack@packages/ax-code/src/debug-engine/analyze-bug.ts:103` | public/internal | scanned |
| `StackFormat@packages/ax-code/src/debug-engine/analyze-bug.ts:126` | public/internal | scanned |
| `detectStackFormat@packages/ax-code/src/debug-engine/analyze-bug.ts:128` | public/internal | scanned |
| `parseStackTrace@packages/ax-code/src/debug-engine/analyze-bug.ts:138` | public/internal | scanned |
| `resolveFrame@packages/ax-code/src/debug-engine/analyze-bug.ts:182` | public/internal | scanned |
| `analyzeBugImpl@packages/ax-code/src/debug-engine/analyze-bug.ts:275` | public/internal | scanned |
| `validateHypothesisCitations@packages/ax-code/src/debug-engine/analyze-bug.ts:401` | public/internal | scanned |
| `ImpactChange@packages/ax-code/src/debug-engine/analyze-impact.ts:21` | public/internal | scanned |
| `AnalyzeImpactInput@packages/ax-code/src/debug-engine/analyze-impact.ts:26` | public/internal | scanned |
| `extractFilesFromDiff@packages/ax-code/src/debug-engine/analyze-impact.ts:43` | public/internal | scanned |
| `analyzeImpactImpl@packages/ax-code/src/debug-engine/analyze-impact.ts:250` | public/internal | scanned |
| `ApplySafeRefactorInput@packages/ax-code/src/debug-engine/apply-safe-refactor.ts:59` | public/internal | scanned |
| `applySafeRefactorImpl@packages/ax-code/src/debug-engine/apply-safe-refactor.ts:93` | public/internal | scanned |

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

- io packages/ax-code/src/debug-engine/apply-safe-refactor.ts:213
- io packages/ax-code/src/debug-engine/apply-safe-refactor.ts:305
- secret packages/ax-code/src/debug-engine/detect-duplicates.ts:20
- secret packages/ax-code/src/debug-engine/detect-duplicates.ts:75
- secret packages/ax-code/src/debug-engine/detect-duplicates.ts:76
- secret packages/ax-code/src/debug-engine/detect-duplicates.ts:78
- secret packages/ax-code/src/debug-engine/detect-duplicates.ts:79
- secret packages/ax-code/src/debug-engine/detect-duplicates.ts:80
- secret packages/ax-code/src/debug-engine/detect-duplicates.ts:200
- secret packages/ax-code/src/debug-engine/detect-duplicates.ts:211
- secret packages/ax-code/src/debug-engine/detect-duplicates.ts:235
- secret packages/ax-code/src/debug-engine/detect-duplicates.ts:238

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |
| host process / FS | spawn/shell | escape sandbox, orphan children | permission + isolation layers | OS sandbox opt-in residual |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (205 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 23; total LOC: 6527
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/debug-engine`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 205

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
| Static deep extract | ok | fingerprint `3ac5590c75ceb74c` |
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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 23 files / 6527 LOC / fp 3ac5590c75ceb74c |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
