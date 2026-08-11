# MODULE-AUDIT: cli-cmd-memory

| Field | Value |
|-------|-------|
| Unit slug | `cli-cmd-memory` |
| Scope | `packages/ax-code/src/cli/cmd/memory` |
| Resolved root | `packages/ax-code/src/cli/cmd/memory.ts` |
| XL filter | no |
| Wave / effort | Wave 6 / S |
| Risk tags | cli |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `cab6c0089e3b7b3410f050bc9d824c06a3c3a814` |
| Analysis fingerprint | `4c0e2d3958c9e416` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 1 / 564 |
| Inventory ID | W6-41 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/cli/cmd/memory.ts` | 564 | 12 | 0 | 0 |

### Exports (sample)
- `applyMemoryEvalExitCode@packages/ax-code/src/cli/cmd/memory.ts:30`
- `applyMemoryDoctorExitCode@packages/ax-code/src/cli/cmd/memory.ts:37`
- `MemoryCommand@packages/ax-code/src/cli/cmd/memory.ts:47`
- `MemoryWarmupCommand@packages/ax-code/src/cli/cmd/memory.ts:65`
- `MemoryStatusCommand@packages/ax-code/src/cli/cmd/memory.ts:119`
- `MemoryClearCommand@packages/ax-code/src/cli/cmd/memory.ts:142`
- `MemoryRememberCommand@packages/ax-code/src/cli/cmd/memory.ts:182`
- `MemoryForgetCommand@packages/ax-code/src/cli/cmd/memory.ts:260`
- `MemoryRecallCommand@packages/ax-code/src/cli/cmd/memory.ts:294`
- `MemoryListCommand@packages/ax-code/src/cli/cmd/memory.ts:390`
- `MemoryDoctorCommand@packages/ax-code/src/cli/cmd/memory.ts:430`
- `MemoryEvalCommand@packages/ax-code/src/cli/cmd/memory.ts:488`

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
| Module contract | public exports (12) | static map |
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
| Static extract | ok fp `4c0e2d3958c9e416` |
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
| Reviewer | codex-sol | 2026-08-11 | filesRead=13 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
