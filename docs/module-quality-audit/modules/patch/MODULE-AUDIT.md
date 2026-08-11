# MODULE-AUDIT: patch

| Field | Value |
|-------|-------|
| Unit slug | `patch` |
| Scope | `packages/ax-code/src/patch` |
| Resolved root | `packages/ax-code/src/patch` |
| XL filter | no |
| Wave / effort | Wave 3 / M |
| Risk tags | correctness |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8a38b90b950855545c6b2479220274357904f111` |
| Analysis fingerprint | `11132bb694b5b7e4` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 1 / 787 |
| Inventory ID | W3-07 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/patch/index.ts` | 787 | 18 | 0 | 0 |

### Exports (sample)
- `Patch@packages/ax-code/src/patch/index.ts:11`
- `PatchSchema@packages/ax-code/src/patch/index.ts:15`
- `PatchParams@packages/ax-code/src/patch/index.ts:19`
- `ApplyPatchArgs@packages/ax-code/src/patch/index.ts:22`
- `Hunk@packages/ax-code/src/patch/index.ts:28`
- `UpdateFileChunk@packages/ax-code/src/patch/index.ts:33`
- `ApplyPatchAction@packages/ax-code/src/patch/index.ts:40`
- `ApplyPatchFileChange@packages/ax-code/src/patch/index.ts:46`
- `AffectedPaths@packages/ax-code/src/patch/index.ts:51`
- `ApplyPatchError@packages/ax-code/src/patch/index.ts:57`
- `MaybeApplyPatch@packages/ax-code/src/patch/index.ts:64`
- `MaybeApplyPatchVerified@packages/ax-code/src/patch/index.ts:71`
- `parsePatch@packages/ax-code/src/patch/index.ts:222`
- `maybeParseApplyPatch@packages/ax-code/src/patch/index.ts:285`
- `deriveNewContentsFromChunks@packages/ax-code/src/patch/index.ts:347`
- `applyHunksToFiles@packages/ax-code/src/patch/index.ts:604`
- `applyPatch@packages/ax-code/src/patch/index.ts:665`
- `maybeParseApplyPatchVerified@packages/ax-code/src/patch/index.ts:671`

### Tests
- `packages/ax-code/test/cli/tui/dialogs-action-dispatch.test.ts`
- `packages/ax-code/test/code-intelligence/query-native-dispatch.test.ts`
- `packages/ax-code/test/dispatch/index.test.ts`
- `packages/ax-code/test/dispatch/merge-strategies.test.ts`
- `packages/ax-code/test/patch/patch.test.ts`
- `packages/ax-code/test/tool/apply_patch.test.ts`
- `packages/ax-code/test/workflow/dispatch-adapter.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (18) | static map |
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
| Static extract | ok fp `11132bb694b5b7e4` |
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
