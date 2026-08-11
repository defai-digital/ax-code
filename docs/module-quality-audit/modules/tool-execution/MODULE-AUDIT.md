# MODULE-AUDIT: tool-execution

| Field | Value |
|-------|-------|
| Unit slug | `tool-execution` |
| Scope | `packages/ax-code/src/tool (bash/shell execution)` |
| Resolved root | `packages/ax-code/src/tool` |
| XL filter | yes |
| Wave / effort | Wave 3 / L |
| Risk tags | security, hot-path |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `cab6c0089e3b7b3410f050bc9d824c06a3c3a814` |
| Analysis fingerprint | `8ac761467d467434` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 7 / 1821 |
| Inventory ID | W3-03b |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/tool/bash-background.ts` | 342 | 14 | 0 | 0 |
| `packages/ax-code/src/tool/bash-destructive.ts` | 178 | 1 | 0 | 0 |
| `packages/ax-code/src/tool/bash-helpers.ts` | 128 | 11 | 0 | 0 |
| `packages/ax-code/src/tool/bash-impl.ts` | 1050 | 1 | 0 | 1 |
| `packages/ax-code/src/tool/bash.ts` | 2 | 0 | 0 | 0 |
| `packages/ax-code/src/tool/bash_output.ts` | 87 | 1 | 0 | 0 |
| `packages/ax-code/src/tool/kill_shell.ts` | 34 | 1 | 0 | 0 |

### Exports (sample)
- `BackgroundShell@packages/ax-code/src/tool/bash-background.ts:18`
- `Status@packages/ax-code/src/tool/bash-background.ts:19`
- `OutputStream@packages/ax-code/src/tool/bash-background.ts:20`
- `Observer@packages/ax-code/src/tool/bash-background.ts:22`
- `Info@packages/ax-code/src/tool/bash-background.ts:39`
- `assertCapacity@packages/ax-code/src/tool/bash-background.ts:68`
- `register@packages/ax-code/src/tool/bash-background.ts:89`
- `get@packages/ax-code/src/tool/bash-background.ts:243`
- `list@packages/ax-code/src/tool/bash-background.ts:250`
- `observe@packages/ax-code/src/tool/bash-background.ts:259`
- `read@packages/ax-code/src/tool/bash-background.ts:297`
- `kill@packages/ax-code/src/tool/bash-background.ts:311`
- `killForSession@packages/ax-code/src/tool/bash-background.ts:324`
- `resetForTests@packages/ax-code/src/tool/bash-background.ts:337`
- `classifyDestructiveCommand@packages/ax-code/src/tool/bash-destructive.ts:142`
- `hasDynamicShellExpansion@packages/ax-code/src/tool/bash-helpers.ts:3`
- `assertStaticRedirectTarget@packages/ax-code/src/tool/bash-helpers.ts:7`
- `stripShellQuotes@packages/ax-code/src/tool/bash-helpers.ts:13`
- `expandLeadingTilde@packages/ax-code/src/tool/bash-helpers.ts:19`
- `isStaticPathArg@packages/ax-code/src/tool/bash-helpers.ts:34`

### Tests
- `packages/ax-code/test/cli/tui/session-tool-rendering.test.ts`
- `packages/ax-code/test/control-plane/execution-controller.test.ts`
- `packages/ax-code/test/graph/execution-graph.test.ts`
- `packages/ax-code/test/mcp/tool-conversion.test.ts`
- `packages/ax-code/test/replay/tool-call-query.test.ts`
- `packages/ax-code/test/replay/tool-result-metadata.test.ts`
- `packages/ax-code/test/session/prompt-command-execution.test.ts`
- `packages/ax-code/test/session/prompt-tools.test.ts`
- `packages/ax-code/test/session/tool-error-pattern.test.ts`
- `packages/ax-code/test/tool/apply_patch.test.ts`
- `packages/ax-code/test/tool/arena-implement.test.ts`
- `packages/ax-code/test/tool/arena-tool.test.ts`
- `packages/ax-code/test/tool/arena.test.ts`
- `packages/ax-code/test/tool/bash-background.test.ts`
- `packages/ax-code/test/tool/bash-destructive.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (29) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags security,hot-path | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-tool-execution-001 | security | Critical | prior/new | verified-fixed |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `8ac761467d467434` |
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
| Reviewer | codex-sol | 2026-08-11 | filesRead=18 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
