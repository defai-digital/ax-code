# MODULE-AUDIT: cli-cmd-debug

| Field | Value |
|-------|-------|
| Unit slug | `cli-cmd-debug` |
| Scope | `packages/ax-code/src/cli/cmd/debug` |
| Resolved root | `packages/ax-code/src/cli/cmd/debug` |
| XL filter | no |
| Wave / effort | Wave 6 / L |
| Risk tags | cli |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `ad9a854c3f8f6cc3ffc48c356a2546d3f23e9945` |
| Analysis fingerprint | `d7ca0d11859e5cfe` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 13 / 2621 |
| Inventory ID | W6-17 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/cli/cmd/debug/agent.ts` | 178 | 4 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/debug/config.ts` | 17 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/debug/explain-impl.ts` | 1203 | 11 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/debug/explain.ts` | 2 | 0 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/debug/file.ts` | 98 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/debug/index.ts` | 58 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/debug/lsp.ts` | 54 | 3 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/debug/perf.ts` | 588 | 8 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/debug/replay.ts` | 248 | 2 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/debug/ripgrep.ts` | 88 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/debug/scrap.ts` | 17 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/debug/skill.ts` | 17 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/debug/snapshot.ts` | 53 | 1 | 0 | 0 |

### Exports (sample)
- `ToolParams@packages/ax-code/src/cli/cmd/debug/agent.ts:17`
- `AgentCommand@packages/ax-code/src/cli/cmd/debug/agent.ts:19`
- `decodeToolParamsValue@packages/ax-code/src/cli/cmd/debug/agent.ts:93`
- `parseToolParams@packages/ax-code/src/cli/cmd/debug/agent.ts:101`
- `ConfigCommand@packages/ax-code/src/cli/cmd/debug/config.ts:6`
- `DiagnosticIssue@packages/ax-code/src/cli/cmd/debug/explain-impl.ts:48`
- `ReplayDebugRecord@packages/ax-code/src/cli/cmd/debug/explain-impl.ts:59`
- `ProcessDebugRecord@packages/ax-code/src/cli/cmd/debug/explain-impl.ts:66`
- `classifyErrors@packages/ax-code/src/cli/cmd/debug/explain-impl.ts:149`
- `scanStandardLogLines@packages/ax-code/src/cli/cmd/debug/explain-impl.ts:287`
- `parseReplayEventLines@packages/ax-code/src/cli/cmd/debug/explain-impl.ts:356`
- `parseProcessEventLines@packages/ax-code/src/cli/cmd/debug/explain-impl.ts:378`
- `classifyReplayIssues@packages/ax-code/src/cli/cmd/debug/explain-impl.ts:398`
- `classifyProcessIssues@packages/ax-code/src/cli/cmd/debug/explain-impl.ts:524`
- `collectStandardLogDirs@packages/ax-code/src/cli/cmd/debug/explain-impl.ts:1042`
- `ExplainCommand@packages/ax-code/src/cli/cmd/debug/explain-impl.ts:1103`
- `FileCommand@packages/ax-code/src/cli/cmd/debug/file.ts:85`
- `DebugCommand@packages/ax-code/src/cli/cmd/debug/index.ts:16`
- `LSPCommand@packages/ax-code/src/cli/cmd/debug/lsp.ts:8`
- `SymbolsCommand@packages/ax-code/src/cli/cmd/debug/lsp.ts:29`

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
| Module contract | public exports (35) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags cli | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `d7ca0d11859e5cfe` |
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
