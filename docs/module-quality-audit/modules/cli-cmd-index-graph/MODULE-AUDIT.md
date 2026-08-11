# MODULE-AUDIT: cli-cmd-index-graph

| Field | Value |
|-------|-------|
| Unit slug | `cli-cmd-index-graph` |
| Scope | `packages/ax-code/src/cli/cmd/index-graph` |
| Resolved root | `packages/ax-code/src/cli/cmd/index-graph.ts` |
| XL filter | no |
| Wave / effort | Wave 6 / S |
| Risk tags | cli |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `cab6c0089e3b7b3410f050bc9d824c06a3c3a814` |
| Analysis fingerprint | `99fec64b5a776950` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 1 / 732 |
| Inventory ID | W6-39 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/cli/cmd/index-graph.ts` | 732 | 9 | 0 | 0 |

### Exports (sample)
- `isIndexableFile@packages/ax-code/src/cli/cmd/index-graph.ts:32`
- `groupFilesByLanguage@packages/ax-code/src/cli/cmd/index-graph.ts:41`
- `phaseRows@packages/ax-code/src/cli/cmd/index-graph.ts:123`
- `buildIndexReport@packages/ax-code/src/cli/cmd/index-graph.ts:138`
- `highlightLines@packages/ax-code/src/cli/cmd/index-graph.ts:198`
- `validateIndexConcurrency@packages/ax-code/src/cli/cmd/index-graph.ts:215`
- `validateIndexLimit@packages/ax-code/src/cli/cmd/index-graph.ts:222`
- `probeLspServers@packages/ax-code/src/cli/cmd/index-graph.ts:243`
- `IndexCommand@packages/ax-code/src/cli/cmd/index-graph.ts:304`

### Tests
- `packages/ax-code/test/acp/sdk-client-naming.test.ts`
- `packages/ax-code/test/cli/account.test.ts`
- `packages/ax-code/test/cli/acp.test.ts`
- `packages/ax-code/test/cli/agent.test.ts`
- `packages/ax-code/test/cli/audit.test.ts`
- `packages/ax-code/test/cli/boot.test.ts`
- `packages/ax-code/test/cli/bootstrap/windows-console.test.ts`
- `packages/ax-code/test/cli/capability.test.ts`
- `packages/ax-code/test/cli/cmd/tui/component/slash-frecency.test.ts`
- `packages/ax-code/test/cli/cmd/tui/prompt-part.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/autonomous-active.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/coalesce.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/footer-view-model.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/format.test.ts`
- `packages/ax-code/test/cli/cmd/tui/ui/glyphs.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (9) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags cli | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `99fec64b5a776950` |
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
| Reviewer | codex-sol | 2026-08-11 | filesRead=21 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
