# MODULE-AUDIT: worktree

| Field | Value |
|-------|-------|
| Unit slug | `worktree` |
| Scope | `packages/ax-code/src/worktree` |
| Resolved root | `packages/ax-code/src/worktree` |
| XL filter | no |
| Wave / effort | Wave 3 / M |
| Risk tags | correctness |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `5fefa00cdc847667d3ba3d38509a751498ee4180` |
| Analysis fingerprint | `9df34adad83e9a83` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 2 / 941 |
| Inventory ID | W3-08 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/worktree/index-impl.ts` | 939 | 27 | 0 | 0 |
| `packages/ax-code/src/worktree/index.ts` | 2 | 0 | 0 | 0 |

### Exports (sample)
- `Worktree@packages/ax-code/src/worktree/index-impl.ts:18`
- `Event@packages/ax-code/src/worktree/index-impl.ts:21`
- `Info@packages/ax-code/src/worktree/index-impl.ts:37`
- `Info@packages/ax-code/src/worktree/index-impl.ts:47`
- `ListItem@packages/ax-code/src/worktree/index-impl.ts:49`
- `ListItem@packages/ax-code/src/worktree/index-impl.ts:59`
- `CreateInput@packages/ax-code/src/worktree/index-impl.ts:61`
- `CreateInput@packages/ax-code/src/worktree/index-impl.ts:73`
- `RemoveInput@packages/ax-code/src/worktree/index-impl.ts:85`
- `RemoveInput@packages/ax-code/src/worktree/index-impl.ts:93`
- `ResetInput@packages/ax-code/src/worktree/index-impl.ts:95`
- `ResetInput@packages/ax-code/src/worktree/index-impl.ts:103`
- `NotGitError@packages/ax-code/src/worktree/index-impl.ts:105`
- `NameGenerationFailedError@packages/ax-code/src/worktree/index-impl.ts:112`
- `CreateFailedError@packages/ax-code/src/worktree/index-impl.ts:119`
- `StartCommandFailedError@packages/ax-code/src/worktree/index-impl.ts:126`
- `RemoveFailedError@packages/ax-code/src/worktree/index-impl.ts:133`
- `ResetFailedError@packages/ax-code/src/worktree/index-impl.ts:140`
- `list@packages/ax-code/src/worktree/index-impl.ts:333`
- `runStartScripts@packages/ax-code/src/worktree/index-impl.ts:405`

### Tests
- `packages/ax-code/test/mode/worktree-policy.test.ts`
- `packages/ax-code/test/project/worktree-remove.test.ts`
- `packages/ax-code/test/worktree/worktree.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (27) | static map |
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
| Static extract | ok fp `9df34adad83e9a83` |
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
| Reviewer | ax-code-glm | 2026-08-11 | filesRead=7 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
