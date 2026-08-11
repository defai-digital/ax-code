# MODULE-AUDIT: debug-engine

| Field | Value |
|-------|-------|
| Unit slug | `debug-engine` |
| Scope | `packages/ax-code/src/debug-engine` |
| Resolved root | `packages/ax-code/src/debug-engine` |
| XL filter | no |
| Wave / effort | Wave 5 / M |
| Risk tags | correctness |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `994f9287e497666e104644eccea299595a35b39a` |
| Analysis fingerprint | `fe8fc37a70cc791a` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 23 / 6527 |
| Inventory ID | W5-16 |

## 1. Scope and map

### Source inventory

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
| `packages/ax-code/src/debug-engine/id.ts` | 15 | 6 | 0 | 0 |
| `packages/ax-code/src/debug-engine/incremental.ts` | 150 | 6 | 0 | 0 |
| `packages/ax-code/src/debug-engine/index.ts` | 452 | 47 | 0 | 0 |
| `packages/ax-code/src/debug-engine/language-scan.ts` | 480 | 22 | 0 | 0 |
| `packages/ax-code/src/debug-engine/native-scan.ts` | 235 | 14 | 0 | 0 |
| `packages/ax-code/src/debug-engine/pattern-memory.ts` | 414 | 6 | 0 | 0 |
| `packages/ax-code/src/debug-engine/plan-refactor.ts` | 284 | 3 | 0 | 0 |
| `packages/ax-code/src/debug-engine/prewarm-lsp.ts` | 93 | 2 | 0 | 0 |
| `packages/ax-code/src/debug-engine/query.ts` | 122 | 14 | 0 | 0 |
| `packages/ax-code/src/debug-engine/runtime-debug.ts` | 189 | 29 | 0 | 0 |
| `packages/ax-code/src/debug-engine/scanner-utils.ts` | 182 | 12 | 0 | 0 |
| `packages/ax-code/src/debug-engine/schema.sql.ts` | 140 | 7 | 0 | 0 |
| `packages/ax-code/src/debug-engine/shadow-worktree.ts` | 294 | 8 | 0 | 0 |
| `packages/ax-code/src/debug-engine/verify-after-fix.ts` | 117 | 8 | 0 | 0 |

### Exports (sample)
- `AnalyzeBugInput@packages/ax-code/src/debug-engine/analyze-bug.ts:22`
- `parseTypeScriptStack@packages/ax-code/src/debug-engine/analyze-bug.ts:60`
- `parsePythonStack@packages/ax-code/src/debug-engine/analyze-bug.ts:103`
- `StackFormat@packages/ax-code/src/debug-engine/analyze-bug.ts:126`
- `detectStackFormat@packages/ax-code/src/debug-engine/analyze-bug.ts:128`
- `parseStackTrace@packages/ax-code/src/debug-engine/analyze-bug.ts:138`
- `resolveFrame@packages/ax-code/src/debug-engine/analyze-bug.ts:182`
- `analyzeBugImpl@packages/ax-code/src/debug-engine/analyze-bug.ts:275`
- `validateHypothesisCitations@packages/ax-code/src/debug-engine/analyze-bug.ts:401`
- `ImpactChange@packages/ax-code/src/debug-engine/analyze-impact.ts:21`
- `AnalyzeImpactInput@packages/ax-code/src/debug-engine/analyze-impact.ts:26`
- `extractFilesFromDiff@packages/ax-code/src/debug-engine/analyze-impact.ts:43`
- `analyzeImpactImpl@packages/ax-code/src/debug-engine/analyze-impact.ts:250`
- `ApplySafeRefactorInput@packages/ax-code/src/debug-engine/apply-safe-refactor.ts:59`
- `applySafeRefactorImpl@packages/ax-code/src/debug-engine/apply-safe-refactor.ts:93`
- `DetectDuplicatesInput@packages/ax-code/src/debug-engine/detect-duplicates.ts:26`
- `normalizeSignature@packages/ax-code/src/debug-engine/detect-duplicates.ts:51`
- `detectDuplicatesImpl@packages/ax-code/src/debug-engine/detect-duplicates.ts:157`
- `DetectHardcodesInput@packages/ax-code/src/debug-engine/detect-hardcodes.ts:35`
- `detectHardcodesImpl@packages/ax-code/src/debug-engine/detect-hardcodes.ts:339`

### Tests
- `packages/ax-code/test/cli/debug-agent.test.ts`
- `packages/ax-code/test/cli/debug-explain.test.ts`
- `packages/ax-code/test/cli/debug-perf.test.ts`
- `packages/ax-code/test/cli/debug-replay.test.ts`
- `packages/ax-code/test/cli/mcp-debug.test.ts`
- `packages/ax-code/test/debug/diagnostic-log.test.ts`
- `packages/ax-code/test/debug-engine/debug-engine.test.ts`
- `packages/ax-code/test/debug-engine/diagnostic-correlation.test.ts`
- `packages/ax-code/test/debug-engine/incremental.test.ts`
- `packages/ax-code/test/debug-engine/language-scan.test.ts`
- `packages/ax-code/test/debug-engine/native-scan.test.ts`
- `packages/ax-code/test/debug-engine/pattern-memory.test.ts`
- `packages/ax-code/test/debug-engine/phase2-3.test.ts`
- `packages/ax-code/test/debug-engine/prewarm-lsp.test.ts`
- `packages/ax-code/test/debug-engine/query.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (219) | static map |
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
| Static extract | ok fp `fe8fc37a70cc791a` |
| Dual-agent protocol | complete |
| Critical independent verify | ax-code-glm |

### Exit checklist
- [x] Full 9-step protocol by dual-agent/implementer
- [x] Map with unit-scoped files (XL filters applied when configured)
- [x] Findings ledger consistent with findings/ files
- [x] Sign-off roles complete

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | codex-sol | 2026-08-11 | filesRead=52 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
