# MODULE-AUDIT: command

| Field | Value |
|-------|-------|
| Unit slug | `command` |
| Scope | `packages/ax-code/src/command` |
| Resolved root | `packages/ax-code/src/command` |
| XL filter | no |
| Wave / effort | Wave 3 / M |
| Risk tags | security |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `cab6c0089e3b7b3410f050bc9d824c06a3c3a814` |
| Analysis fingerprint | `c412e42de2929fb4` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 2 / 621 |
| Inventory ID | W3-09 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/command/file-command.ts` | 223 | 13 | 0 | 0 |
| `packages/ax-code/src/command/index.ts` | 398 | 9 | 0 | 0 |

### Exports (sample)
- `FileCommand@packages/ax-code/src/command/file-command.ts:8`
- `SourceTool@packages/ax-code/src/command/file-command.ts:9`
- `SourceTool@packages/ax-code/src/command/file-command.ts:10`
- `Scope@packages/ax-code/src/command/file-command.ts:12`
- `Scope@packages/ax-code/src/command/file-command.ts:13`
- `Warning@packages/ax-code/src/command/file-command.ts:15`
- `Warning@packages/ax-code/src/command/file-command.ts:20`
- `Info@packages/ax-code/src/command/file-command.ts:22`
- `Info@packages/ax-code/src/command/file-command.ts:36`
- `parse@packages/ax-code/src/command/file-command.ts:51`
- `parseFile@packages/ax-code/src/command/file-command.ts:130`
- `discover@packages/ax-code/src/command/file-command.ts:151`
- `commandName@packages/ax-code/src/command/file-command.ts:210`
- `Command@packages/ax-code/src/command/index.ts:24`
- `Event@packages/ax-code/src/command/index.ts:25`
- `Info@packages/ax-code/src/command/index.ts:42`
- `Info@packages/ax-code/src/command/index.ts:74`
- `hints@packages/ax-code/src/command/index.ts:87`
- `mcpPromptTemplateText@packages/ax-code/src/command/index.ts:104`
- `Default@packages/ax-code/src/command/index.ts:116`

### Tests
- `packages/ax-code/test/cli/tui/command-autocomplete.test.ts`
- `packages/ax-code/test/cli/tui/session-display-commands.test.ts`
- `packages/ax-code/test/command/file-command.test.ts`
- `packages/ax-code/test/command/hints.test.ts`
- `packages/ax-code/test/session/prompt-command-execution.test.ts`
- `packages/ax-code/test/session/prompt-command-workflow.test.ts`
- `packages/ax-code/test/session/prompt-shell-command.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (22) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags security | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `c412e42de2929fb4` |
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
| Reviewer | codex-sol | 2026-08-11 | filesRead=16 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
