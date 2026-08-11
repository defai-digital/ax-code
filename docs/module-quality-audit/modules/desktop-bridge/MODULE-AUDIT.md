# MODULE-AUDIT: desktop-bridge

| Field | Value |
|-------|-------|
| Unit slug | `desktop-bridge` |
| Scope | `packages/ax-code/src/desktop` |
| Resolved root | `packages/ax-code/src/desktop` |
| XL filter | no |
| Wave / effort | Wave 1 / S |
| Risk tags | desktop |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `ad9a854c3f8f6cc3ffc48c356a2546d3f23e9945` |
| Analysis fingerprint | `05c1c122aa0da5d7` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 1 / 266 |
| Inventory ID | W1-11 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/desktop/webui.ts` | 266 | 8 | 0 | 0 |

### Exports (sample)
- `DEFAULT_WEBUI_PORT@packages/ax-code/src/desktop/webui.ts:9`
- `DesktopInvocation@packages/ax-code/src/desktop/webui.ts:11`
- `WebUiLaunchOptions@packages/ax-code/src/desktop/webui.ts:27`
- `WebUiLaunchResult@packages/ax-code/src/desktop/webui.ts:34`
- `resolveDesktopInvocation@packages/ax-code/src/desktop/webui.ts:113`
- `launchWebUi@packages/ax-code/src/desktop/webui.ts:202`
- `runWebUiDesktopCommand@packages/ax-code/src/desktop/webui.ts:244`
- `__internal@packages/ax-code/src/desktop/webui.ts:263`

### Tests
- `packages/ax-code/test/cli/tui/desktop-handoff.test.ts`
- `packages/ax-code/test/desktop/webui.test.ts`
- `packages/ax-code/test/script/desktop-release-workflow.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (8) | static map |
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
| Static extract | ok fp `05c1c122aa0da5d7` |
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
| Reviewer | codex-sol | 2026-08-11 | filesRead=5 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
