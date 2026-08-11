# MODULE-AUDIT: ui-types

| Field | Value |
|-------|-------|
| Unit slug | `ui-types` |
| Scope | `desktop/packages/ui/src/types` |
| Resolved root | `desktop/packages/ui/src/types` |
| XL filter | no |
| Wave / effort | Wave 8 / S |
| Risk tags | desktop |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `994f9287e497666e104644eccea299595a35b39a` |
| Analysis fingerprint | `6cc8c5e635f6c430` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 16 / 641 |
| Inventory ID | W8-09 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/ui/src/types/codemirror-lang-elixir.d.ts` | 6 | 1 | 0 | 0 |
| `desktop/packages/ui/src/types/desktop.d.ts` | 32 | 0 | 0 | 0 |
| `desktop/packages/ui/src/types/ghostty-web.d.ts` | 12 | 2 | 0 | 0 |
| `desktop/packages/ui/src/types/index.ts` | 29 | 1 | 0 | 0 |
| `desktop/packages/ui/src/types/multirun.ts` | 48 | 7 | 0 | 0 |
| `desktop/packages/ui/src/types/permission.ts` | 15 | 2 | 0 | 0 |
| `desktop/packages/ui/src/types/providerModels.ts` | 5 | 2 | 0 | 0 |
| `desktop/packages/ui/src/types/question.ts` | 22 | 3 | 0 | 0 |
| `desktop/packages/ui/src/types/quota.ts` | 46 | 5 | 0 | 0 |
| `desktop/packages/ui/src/types/react-syntax-highlighter-create-element.d.ts` | 15 | 0 | 0 | 0 |
| `desktop/packages/ui/src/types/sessionMessages.ts` | 7 | 1 | 0 | 0 |
| `desktop/packages/ui/src/types/snippet.ts` | 9 | 1 | 0 | 0 |
| `desktop/packages/ui/src/types/streaming.ts` | 2 | 1 | 0 | 0 |
| `desktop/packages/ui/src/types/theme.ts` | 288 | 24 | 0 | 0 |
| `desktop/packages/ui/src/types/window-globals.d.ts` | 55 | 0 | 0 | 0 |
| `desktop/packages/ui/src/types/worktree.ts` | 50 | 1 | 0 | 0 |

### Exports (sample)
- `elixir@desktop/packages/ui/src/types/codemirror-lang-elixir.d.ts:4`
- `ITerminalOptions@desktop/packages/ui/src/types/ghostty-web.d.ts:4`
- `RendererOptions@desktop/packages/ui/src/types/ghostty-web.d.ts:8`
- `ModelMetadata@desktop/packages/ui/src/types/index.ts:3`
- `MultiRunModelSelection@desktop/packages/ui/src/types/multirun.ts:1`
- `MultiRunFileAttachment@desktop/packages/ui/src/types/multirun.ts:8`
- `MultiRunLocalFileAttachment@desktop/packages/ui/src/types/multirun.ts:14`
- `toMultiRunFileAttachment@desktop/packages/ui/src/types/multirun.ts:22`
- `MultiRunGroup@desktop/packages/ui/src/types/multirun.ts:28`
- `CreateMultiRunParams@desktop/packages/ui/src/types/multirun.ts:33`
- `CreateMultiRunResult@desktop/packages/ui/src/types/multirun.ts:43`
- `PermissionRequest@desktop/packages/ui/src/types/permission.ts:1`
- `PermissionResponse@desktop/packages/ui/src/types/permission.ts:14`
- `ProviderModel@desktop/packages/ui/src/types/providerModels.ts:3`
- `ProviderWithModelList@desktop/packages/ui/src/types/providerModels.ts:4`
- `QuestionOption@desktop/packages/ui/src/types/question.ts:1`
- `QuestionInfo@desktop/packages/ui/src/types/question.ts:6`
- `QuestionRequest@desktop/packages/ui/src/types/question.ts:13`
- `QuotaProviderId@desktop/packages/ui/src/types/quota.ts:1`
- `UsageWindow@desktop/packages/ui/src/types/quota.ts:18`

### Tests
- none auto-matched

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (51) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags desktop | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `6cc8c5e635f6c430` |
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
| Reviewer | codex-sol | 2026-08-11 | filesRead=43 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
