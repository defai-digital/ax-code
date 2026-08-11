# MODULE-AUDIT: server-routes-prompt-history

| Field | Value |
|-------|-------|
| Unit slug | `server-routes-prompt-history` |
| Scope | `packages/ax-code/src/server/routes/prompt-history.ts` |
| Resolved root | `packages/ax-code/src/server/routes/prompt-history.ts` |
| XL filter | no |
| Wave / effort | Wave 4 / S |
| Risk tags | network, api |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `ad9a854c3f8f6cc3ffc48c356a2546d3f23e9945` |
| Analysis fingerprint | `d8ea1d5215c8fe30` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 1 / 66 |
| Inventory ID | W4-03-20 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/server/routes/prompt-history.ts` | 66 | 1 | 0 | 0 |

### Exports (sample)
- `PromptHistoryRoutes@packages/ax-code/src/server/routes/prompt-history.ts:15`

### Tests
- `packages/ax-code/test/acp/agent-prompt.test.ts`
- `packages/ax-code/test/cli/cmd/tui/prompt-part.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/autonomous-active.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/coalesce.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/footer-view-model.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/format.test.ts`
- `packages/ax-code/test/cli/github-agent-prompts.test.ts`
- `packages/ax-code/test/cli/prompt-view-model.test.ts`
- `packages/ax-code/test/cli/tui/prompt-autocomplete-offsets.test.ts`
- `packages/ax-code/test/cli/tui/prompt-filepath.test.ts`
- `packages/ax-code/test/cli/tui/prompt-frecency.test.ts`
- `packages/ax-code/test/cli/tui/prompt-helpers.test.ts`
- `packages/ax-code/test/cli/tui/prompt-info.test.ts`
- `packages/ax-code/test/cli/tui/prompt-liveness-view-model.test.ts`
- `packages/ax-code/test/cli/tui/prompt-paste-view-model.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (1) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags network,api | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `d8ea1d5215c8fe30` |
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
| Reviewer | codex-sol | 2026-08-11 | filesRead=17 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
