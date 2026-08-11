# MODULE-AUDIT: provider-cli

| Field | Value |
|-------|-------|
| Unit slug | `provider-cli` |
| Scope | `packages/ax-code/src/provider/cli` |
| Resolved root | `packages/ax-code/src/provider/cli` |
| XL filter | no |
| Wave / effort | Wave 5 / L |
| Risk tags | stability, process |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `046510f0ca8a215f632e99fa92aa0633d684cbb9` |
| Analysis fingerprint | `006bcd2735fedf13` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 10 / 1721 |
| Inventory ID | W5-03 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/provider/cli/attachments.ts` | 131 | 3 | 0 | 0 |
| `packages/ax-code/src/provider/cli/binary.ts` | 29 | 1 | 0 | 0 |
| `packages/ax-code/src/provider/cli/cli-language-model.ts` | 659 | 4 | 0 | 0 |
| `packages/ax-code/src/provider/cli/config.ts` | 77 | 3 | 0 | 0 |
| `packages/ax-code/src/provider/cli/connect.ts` | 146 | 6 | 0 | 0 |
| `packages/ax-code/src/provider/cli/effort.ts` | 31 | 4 | 0 | 0 |
| `packages/ax-code/src/provider/cli/json.ts` | 26 | 3 | 0 | 0 |
| `packages/ax-code/src/provider/cli/parser.ts` | 332 | 11 | 0 | 0 |
| `packages/ax-code/src/provider/cli/prompt.ts` | 99 | 2 | 0 | 0 |
| `packages/ax-code/src/provider/cli/resolve.ts` | 191 | 3 | 0 | 0 |

### Exports (sample)
- `CliAttachmentRef@packages/ax-code/src/provider/cli/attachments.ts:12`
- `MaterializedCliAttachments@packages/ax-code/src/provider/cli/attachments.ts:19`
- `materializeCliAttachments@packages/ax-code/src/provider/cli/attachments.ts:86`
- `selectPreferredCodexBinary@packages/ax-code/src/provider/cli/binary.ts:22`
- `CliLanguageModelConfig@packages/ax-code/src/provider/cli/cli-language-model.ts:25`
- `cliEnv@packages/ax-code/src/provider/cli/cli-language-model.ts:69`
- `buildCliCommand@packages/ax-code/src/provider/cli/cli-language-model.ts:154`
- `CliLanguageModel@packages/ax-code/src/provider/cli/cli-language-model.ts:197`
- `CliProviderDefinition@packages/ax-code/src/provider/cli/config.ts:12`
- `CLI_PROVIDER_DEFINITIONS@packages/ax-code/src/provider/cli/config.ts:21`
- `getCliProviderDefinition@packages/ax-code/src/provider/cli/config.ts:74`
- `CLI_CONNECT_TIMEOUT_MS@packages/ax-code/src/provider/cli/connect.ts:9`
- `checkCliProviderAuth@packages/ax-code/src/provider/cli/connect.ts:72`
- `CliProviderProbeResult@packages/ax-code/src/provider/cli/connect.ts:77`
- `CliLanguageModelProbeConfig@packages/ax-code/src/provider/cli/connect.ts:82`
- `probeCliLanguageModel@packages/ax-code/src/provider/cli/connect.ts:94`
- `probeCliProvider@packages/ax-code/src/provider/cli/connect.ts:130`
- `cliEffortLevels@packages/ax-code/src/provider/cli/effort.ts:7`
- `cliEffortVariants@packages/ax-code/src/provider/cli/effort.ts:11`
- `cliEffortFromProviderOptions@packages/ax-code/src/provider/cli/effort.ts:15`

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
| Module contract | public exports (40) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags stability,process | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-provider-cli-001 | stability | Critical | prior/new | verified-fixed |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `006bcd2735fedf13` |
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
| Reviewer | codex-sol | 2026-08-11 | filesRead=23 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
