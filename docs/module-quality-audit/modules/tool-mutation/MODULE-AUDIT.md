# MODULE-AUDIT: tool-mutation

| Field | Value |
|-------|-------|
| Unit slug | `tool-mutation` |
| Scope | `packages/ax-code/src/tool (edit/write/apply_patch/mutation)` |
| Resolved root | `packages/ax-code/src/tool` |
| XL filter | yes |
| Wave / effort | Wave 3 / L |
| Risk tags | security, correctness |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8a38b90b950855545c6b2479220274357904f111` |
| Analysis fingerprint | `28ef8548fddc8729` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 7 / 2018 |
| Inventory ID | W3-03a |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/tool/apply_patch.ts` | 540 | 1 | 0 | 0 |
| `packages/ax-code/src/tool/edit-helpers.ts` | 67 | 5 | 0 | 0 |
| `packages/ax-code/src/tool/edit-impl.ts` | 849 | 4 | 0 | 0 |
| `packages/ax-code/src/tool/edit.ts` | 2 | 0 | 0 | 0 |
| `packages/ax-code/src/tool/multiedit.ts` | 205 | 1 | 0 | 0 |
| `packages/ax-code/src/tool/notebook_edit.ts` | 210 | 1 | 0 | 0 |
| `packages/ax-code/src/tool/write.ts` | 145 | 1 | 0 | 0 |

### Exports (sample)
- `ApplyPatchTool@packages/ax-code/src/tool/apply_patch.ts:39`
- `LineEnding@packages/ax-code/src/tool/edit-helpers.ts:1`
- `normalizeLineEndings@packages/ax-code/src/tool/edit-helpers.ts:3`
- `detectLineEnding@packages/ax-code/src/tool/edit-helpers.ts:7`
- `convertToLineEnding@packages/ax-code/src/tool/edit-helpers.ts:11`
- `spliceNormalizedReplacement@packages/ax-code/src/tool/edit-helpers.ts:32`
- `parseNativeEditReplaceResult@packages/ax-code/src/tool/edit-impl.ts:38`
- `EditTool@packages/ax-code/src/tool/edit-impl.ts:42`
- `trimDiff@packages/ax-code/src/tool/edit-impl.ts:704`
- `replace@packages/ax-code/src/tool/edit-impl.ts:740`
- `MultiEditTool@packages/ax-code/src/tool/multiedit.ts:21`
- `NotebookEditTool@packages/ax-code/src/tool/notebook_edit.ts:54`
- `WriteTool@packages/ax-code/src/tool/write.ts:44`

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
| Module contract | public exports (13) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags security,correctness | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `28ef8548fddc8729` |
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
