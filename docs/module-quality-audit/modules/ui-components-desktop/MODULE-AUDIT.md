# MODULE-AUDIT: ui-components-desktop

| Field | Value |
|-------|-------|
| Unit slug | `ui-components-desktop` |
| Scope | `desktop/packages/ui/src/components/desktop` |
| Resolved root | `desktop/packages/ui/src/components/desktop` |
| XL filter | no |
| Wave / effort | Wave 8 / S |
| Risk tags | desktop, ui |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `994f9287e497666e104644eccea299595a35b39a` |
| Analysis fingerprint | `86881a3110692823` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 2 / 1647 |
| Inventory ID | W8-03-05 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/ui/src/components/desktop/DesktopHostSwitcher.tsx` | 1448 | 3 | 0 | 0 |
| `desktop/packages/ui/src/components/desktop/OpenInAppButton.tsx` | 199 | 1 | 0 | 0 |

### Exports (sample)
- `DesktopHostSwitcherDialog@desktop/packages/ui/src/components/desktop/DesktopHostSwitcher.tsx:248`
- `DesktopHostSwitcherButton@desktop/packages/ui/src/components/desktop/DesktopHostSwitcher.tsx:1186`
- `DesktopHostSwitcherInline@desktop/packages/ui/src/components/desktop/DesktopHostSwitcher.tsx:1423`
- `OpenInAppButton@desktop/packages/ui/src/components/desktop/OpenInAppButton.tsx:72`

### Tests
- `packages/ax-code/test/cli/tui/desktop-handoff.test.ts`
- `packages/ax-code/test/desktop/webui.test.ts`
- `packages/ax-code/test/script/desktop-release-workflow.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (4) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags desktop,ui | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `86881a3110692823` |
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
| Reviewer | codex-sol | 2026-08-11 | filesRead=15 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
