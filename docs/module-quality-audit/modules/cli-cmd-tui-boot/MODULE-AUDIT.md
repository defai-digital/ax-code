# MODULE-AUDIT: cli-cmd-tui-boot

| Field | Value |
|-------|-------|
| Unit slug | `cli-cmd-tui-boot` |
| Scope | `packages/ax-code/src/cli/cmd/tui boot/worker` |
| Resolved root | `packages/ax-code/src/cli/cmd/tui` |
| XL filter | yes |
| Wave / effort | Wave 6 / L |
| Risk tags | cli |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `994f9287e497666e104644eccea299595a35b39a` |
| Analysis fingerprint | `11686cfcb7ea509a` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 108 / 17427 |
| Inventory ID | W6-08a |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/cli/cmd/tui/app.tsx` | 1613 | 2 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/attach.ts` | 94 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/backend.ts` | 17 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/border.tsx` | 22 | 2 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/dialog-agent.tsx` | 35 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/dialog-command.tsx` | 255 | 4 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/dialog-diff-viewer.tsx` | 187 | 2 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/dialog-effort.tsx` | 52 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/dialog-mcp.tsx` | 91 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/dialog-model-options.ts` | 21 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/dialog-model.tsx` | 170 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/dialog-provider-options.ts` | 182 | 17 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/dialog-provider.tsx` | 1149 | 2 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/dialog-session-list.tsx` | 254 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/dialog-session-rename.tsx` | 47 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/dialog-skill.tsx` | 41 | 2 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/dialog-stash.tsx` | 87 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/dialog-status.tsx` | 168 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/dialog-theme-list.tsx` | 57 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/dialog-workspace-list.tsx` | 379 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/home-view-model.ts` | 4 | 0 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/logo.tsx` | 21 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/model-vision-label.ts` | 61 | 6 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/prompt/autocomplete-command.ts` | 8 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/prompt/autocomplete-scroll.ts` | 48 | 4 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/prompt/autocomplete.tsx` | 917 | 10 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/prompt/follow-up-queue-store.ts` | 189 | 14 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/prompt/follow-up-queue.ts` | 81 | 12 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/prompt/footer-layout.ts` | 57 | 3 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/prompt/footer-toggle.ts` | 4 | 1 | 0 | 0 |

### Exports (sample)
- `TuiInput@packages/ax-code/src/cli/cmd/tui/app.tsx:87`
- `tui@packages/ax-code/src/cli/cmd/tui/app.tsx:98`
- `AttachCommand@packages/ax-code/src/cli/cmd/tui/attach.ts:12`
- `TuiBackendCommand@packages/ax-code/src/cli/cmd/tui/backend.ts:3`
- `EmptyBorder@packages/ax-code/src/cli/cmd/tui/component/border.tsx:1`
- `SplitBorder@packages/ax-code/src/cli/cmd/tui/component/border.tsx:15`
- `DialogAgent@packages/ax-code/src/cli/cmd/tui/component/dialog-agent.tsx:7`
- `Slash@packages/ax-code/src/cli/cmd/tui/component/dialog-command.tsx:28`
- `CommandOption@packages/ax-code/src/cli/cmd/tui/component/dialog-command.tsx:33`
- `useCommandDialog@packages/ax-code/src/cli/cmd/tui/component/dialog-command.tsx:214`
- `CommandProvider@packages/ax-code/src/cli/cmd/tui/component/dialog-command.tsx:222`
- `computeDiffLines@packages/ax-code/src/cli/cmd/tui/component/dialog-diff-viewer.tsx:14`
- `DialogDiffViewer@packages/ax-code/src/cli/cmd/tui/component/dialog-diff-viewer.tsx:136`
- `DialogEffort@packages/ax-code/src/cli/cmd/tui/component/dialog-effort.tsx:8`
- `DialogMcp@packages/ax-code/src/cli/cmd/tui/component/dialog-mcp.tsx:26`
- `dialogModelOptionDisabled@packages/ax-code/src/cli/cmd/tui/component/dialog-model-options.ts:13`
- `DialogModel@packages/ax-code/src/cli/cmd/tui/component/dialog-model.tsx:16`
- `ProviderDialogProvider@packages/ax-code/src/cli/cmd/tui/component/dialog-provider-options.ts:25`
- `normalizeConfiguredProvidersPayload@packages/ax-code/src/cli/cmd/tui/component/dialog-provider-options.ts:41`
- `normalizeProviderListPayload@packages/ax-code/src/cli/cmd/tui/component/dialog-provider-options.ts:54`

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
| Module contract | public exports (362) | static map |
| Silent failure | empty catch (1) | per-site disposition in findings |
| Secrets/process/IO | risk tags cli | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-cli-cmd-tui-boot-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `11686cfcb7ea509a` |
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
| Reviewer | codex-sol | 2026-08-11 | filesRead=26 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
