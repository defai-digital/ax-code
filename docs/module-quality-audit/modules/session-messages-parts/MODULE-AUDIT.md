# MODULE-AUDIT: session-messages-parts

| Field | Value |
|-------|-------|
| Unit slug | `session-messages-parts` |
| Scope | `packages/ax-code/src/session (messages/parts)` |
| Resolved root | `packages/ax-code/src/session` |
| XL filter | yes |
| Wave / effort | Wave 2 / L |
| Risk tags | hot-path, persistence |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `94e95c161c7deb8e055d8806a5f285e516285715` |
| Analysis fingerprint | `ab47ee1942f26348` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 3 / 1336 |
| Inventory ID | W2-01b |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/session/message-v2-impl.ts` | 1238 | 70 | 0 | 0 |
| `packages/ax-code/src/session/message-v2.ts` | 2 | 0 | 0 | 0 |
| `packages/ax-code/src/session/part-write-batcher.ts` | 96 | 2 | 0 | 0 |

### Exports (sample)
- `MessageV2@packages/ax-code/src/session/message-v2-impl.ts:24`
- `isMedia@packages/ax-code/src/session/message-v2-impl.ts:28`
- `OutputLengthError@packages/ax-code/src/session/message-v2-impl.ts:32`
- `AbortedError@packages/ax-code/src/session/message-v2-impl.ts:33`
- `StructuredOutputError@packages/ax-code/src/session/message-v2-impl.ts:34`
- `AuthError@packages/ax-code/src/session/message-v2-impl.ts:41`
- `APIError@packages/ax-code/src/session/message-v2-impl.ts:48`
- `APIError@packages/ax-code/src/session/message-v2-impl.ts:59`
- `ContextOverflowError@packages/ax-code/src/session/message-v2-impl.ts:60`
- `OutputFormatText@packages/ax-code/src/session/message-v2-impl.ts:65`
- `OutputFormatJsonSchema@packages/ax-code/src/session/message-v2-impl.ts:73`
- `Format@packages/ax-code/src/session/message-v2-impl.ts:83`
- `OutputFormat@packages/ax-code/src/session/message-v2-impl.ts:86`
- `SnapshotPart@packages/ax-code/src/session/message-v2-impl.ts:94`
- `SnapshotPart@packages/ax-code/src/session/message-v2-impl.ts:100`
- `PatchPart@packages/ax-code/src/session/message-v2-impl.ts:102`
- `PatchPart@packages/ax-code/src/session/message-v2-impl.ts:109`
- `TextPart@packages/ax-code/src/session/message-v2-impl.ts:111`
- `TextPart@packages/ax-code/src/session/message-v2-impl.ts:126`
- `ReasoningPart@packages/ax-code/src/session/message-v2-impl.ts:128`

### Tests
- `packages/ax-code/test/acp/session-list.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/autonomous-active.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/coalesce.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/footer-view-model.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/format.test.ts`
- `packages/ax-code/test/cli/session-clear-project.test.ts`
- `packages/ax-code/test/cli/tui/h-session-undo-redo-revert-error.test.ts`
- `packages/ax-code/test/cli/tui/s-dialog-session-list-rename-sdk-error.test.ts`
- `packages/ax-code/test/cli/tui/session-child.test.ts`
- `packages/ax-code/test/cli/tui/session-compaction-notice.test.ts`
- `packages/ax-code/test/cli/tui/session-display-commands.test.ts`
- `packages/ax-code/test/cli/tui/session-display.test.ts`
- `packages/ax-code/test/cli/tui/session-entry-sync.test.ts`
- `packages/ax-code/test/cli/tui/session-first-startup-guard.test.ts`
- `packages/ax-code/test/cli/tui/session-format.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (72) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags hot-path,persistence | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `ab47ee1942f26348` |
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
