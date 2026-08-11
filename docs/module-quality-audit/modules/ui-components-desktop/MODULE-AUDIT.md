# MODULE-AUDIT: ui-components-desktop

| Field | Value |
|-------|-------|
| Unit slug | `ui-components-desktop` |
| Scope | `desktop/packages/ui/src/components/desktop` |
| Resolved root | `desktop/packages/ui/src/components/desktop` |
| XL filter | no |
| Wave / effort | Wave 8 / S |
| Risk tags | desktop, ui |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8a38b90b950855545c6b2479220274357904f111` |
| Analysis fingerprint | `86881a3110692823` |
| Protocol marker | pending dual-agent 9-step |
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

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `86881a3110692823` |
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
