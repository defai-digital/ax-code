# MODULE-AUDIT: prompt-history

| Field | Value |
|-------|-------|
| Unit slug | `prompt-history` |
| Scope | `packages/ax-code/src/prompt-history` |
| Resolved root | `packages/ax-code/src/prompt-history` |
| XL filter | no |
| Wave / effort | Wave 2 / S |
| Risk tags | persistence |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `ad9a854c3f8f6cc3ffc48c356a2546d3f23e9945` |
| Analysis fingerprint | `c7479478946b62a5` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 3 / 145 |
| Inventory ID | W2-09 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/prompt-history/index.ts` | 102 | 4 | 0 | 0 |
| `packages/ax-code/src/prompt-history/prompt-history.sql.ts` | 25 | 1 | 0 | 0 |
| `packages/ax-code/src/prompt-history/schema.ts` | 18 | 3 | 0 | 0 |

### Exports (sample)
- `PromptHistory@packages/ax-code/src/prompt-history/index.ts:7`
- `MAX_ENTRIES@packages/ax-code/src/prompt-history/index.ts:9`
- `list@packages/ax-code/src/prompt-history/index.ts:29`
- `append@packages/ax-code/src/prompt-history/index.ts:58`
- `PromptHistoryTable@packages/ax-code/src/prompt-history/prompt-history.sql.ts:6`
- `PromptHistoryPart@packages/ax-code/src/prompt-history/schema.ts:3`
- `PromptHistoryEntry@packages/ax-code/src/prompt-history/schema.ts:9`
- `PromptHistoryEntry@packages/ax-code/src/prompt-history/schema.ts:17`

### Tests
- `packages/ax-code/test/acp/agent-prompt.test.ts`
- `packages/ax-code/test/cli/cmd/tui/prompt-part.test.ts`
- `packages/ax-code/test/cli/github-agent-prompts.test.ts`
- `packages/ax-code/test/cli/prompt-view-model.test.ts`
- `packages/ax-code/test/cli/tui/prompt-autocomplete-offsets.test.ts`
- `packages/ax-code/test/cli/tui/prompt-filepath.test.ts`
- `packages/ax-code/test/cli/tui/prompt-frecency.test.ts`
- `packages/ax-code/test/cli/tui/prompt-helpers.test.ts`
- `packages/ax-code/test/cli/tui/prompt-info.test.ts`
- `packages/ax-code/test/cli/tui/prompt-liveness-view-model.test.ts`
- `packages/ax-code/test/cli/tui/prompt-paste-view-model.test.ts`
- `packages/ax-code/test/cli/tui/prompt-persistence-json.test.ts`
- `packages/ax-code/test/cli/tui/prompt-stash.test.ts`
- `packages/ax-code/test/cli/tui/prompt-submit-key.test.ts`
- `packages/ax-code/test/cli/tui/prompt-submit-state.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (8) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags persistence | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `c7479478946b62a5` |
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
