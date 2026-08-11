# MODULE-AUDIT: cli-cmd-trace

| Field | Value |
|-------|-------|
| Unit slug | `cli-cmd-trace` |
| Scope | `packages/ax-code/src/cli/cmd/trace` |
| Resolved root | `packages/ax-code/src/cli/cmd/trace.ts` |
| XL filter | no |
| Wave / effort | Wave 6 / S |
| Risk tags | cli |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `994f9287e497666e104644eccea299595a35b39a` |
| Analysis fingerprint | `ba57fc909205f90a` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 1 / 426 |
| Inventory ID | W6-47 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/cli/cmd/trace.ts` | 426 | 9 | 0 | 0 |

### Exports (sample)
- `LogEntry@packages/ax-code/src/cli/cmd/trace.ts:23`
- `decodeTraceLogEntryValue@packages/ax-code/src/cli/cmd/trace.ts:38`
- `parseTraceLogEntryJsonLine@packages/ax-code/src/cli/cmd/trace.ts:42`
- `parseTraceTextLogLine@packages/ax-code/src/cli/cmd/trace.ts:54`
- `formatTraceLogTime@packages/ax-code/src/cli/cmd/trace.ts:80`
- `normalizeTraceLimit@packages/ax-code/src/cli/cmd/trace.ts:89`
- `formatTraceLogMessage@packages/ax-code/src/cli/cmd/trace.ts:96`
- `collectTraceErrorCodes@packages/ax-code/src/cli/cmd/trace.ts:100`
- `TraceCommand@packages/ax-code/src/cli/cmd/trace.ts:104`

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
| Static extract | ok fp `ba57fc909205f90a` |
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
