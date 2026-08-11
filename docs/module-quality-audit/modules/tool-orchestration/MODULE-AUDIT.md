# MODULE-AUDIT: tool-orchestration

| Field | Value |
|-------|-------|
| Unit slug | `tool-orchestration` |
| Scope | `packages/ax-code/src/tool (task/arena/council/orchestration)` |
| Resolved root | `packages/ax-code/src/tool` |
| XL filter | yes |
| Wave / effort | Wave 3 / L |
| Risk tags | concurrency |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `046510f0ca8a215f632e99fa92aa0633d684cbb9` |
| Analysis fingerprint | `c3f36ccdb6cf21d5` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 5 / 2576 |
| Inventory ID | W3-03d |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/tool/arena-implement.ts` | 692 | 8 | 0 | 0 |
| `packages/ax-code/src/tool/arena.ts` | 572 | 1 | 0 | 0 |
| `packages/ax-code/src/tool/council.ts` | 442 | 1 | 0 | 0 |
| `packages/ax-code/src/tool/task.ts` | 458 | 1 | 0 | 0 |
| `packages/ax-code/src/tool/task_parallel.ts` | 412 | 1 | 0 | 0 |

### Exports (sample)
- `ImplementMember@packages/ax-code/src/tool/arena-implement.ts:34`
- `linkPrimaryNodeModules@packages/ax-code/src/tool/arena-implement.ts:90`
- `ImplementArenaBasePreflight@packages/ax-code/src/tool/arena-implement.ts:112`
- `inspectImplementArenaBase@packages/ax-code/src/tool/arena-implement.ts:121`
- `ContestantPatchSnapshot@packages/ax-code/src/tool/arena-implement.ts:157`
- `snapshotContestantPatch@packages/ax-code/src/tool/arena-implement.ts:167`
- `runImplementContestant@packages/ax-code/src/tool/arena-implement.ts:368`
- `runImplementArena@packages/ax-code/src/tool/arena-implement.ts:631`
- `ArenaTool@packages/ax-code/src/tool/arena.ts:215`
- `CouncilTool@packages/ax-code/src/tool/council.ts:239`
- `TaskTool@packages/ax-code/src/tool/task.ts:95`
- `TaskParallelTool@packages/ax-code/src/tool/task_parallel.ts:275`

### Tests
- `packages/ax-code/test/cli/tui/session-tool-rendering.test.ts`
- `packages/ax-code/test/mcp/tool-conversion.test.ts`
- `packages/ax-code/test/replay/tool-call-query.test.ts`
- `packages/ax-code/test/replay/tool-result-metadata.test.ts`
- `packages/ax-code/test/session/prompt-tools.test.ts`
- `packages/ax-code/test/session/tool-error-pattern.test.ts`
- `packages/ax-code/test/tool/apply_patch.test.ts`
- `packages/ax-code/test/tool/arena-implement.test.ts`
- `packages/ax-code/test/tool/arena-tool.test.ts`
- `packages/ax-code/test/tool/arena.test.ts`
- `packages/ax-code/test/tool/bash-background.test.ts`
- `packages/ax-code/test/tool/bash-destructive.test.ts`
- `packages/ax-code/test/tool/bash-helpers.test.ts`
- `packages/ax-code/test/tool/bash.test.ts`
- `packages/ax-code/test/tool/batch.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (12) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags concurrency | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `c3f36ccdb6cf21d5` |
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
| Reviewer | ax-code-glm | 2026-08-11 | filesRead=6 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
